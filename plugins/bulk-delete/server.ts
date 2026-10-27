// bb-plugin-bulk-delete backend.
//
// Two operations over bb threads, shared by the sidebar UI (app.tsx, over
// RPC) and the `bb bulk-delete` CLI:
// - delete or archive several threads at once;
// - delete every idle child of a parent thread, keeping the ones still working.
//
// bb's own delete cascades only through lifecycle owners, not through sidebar
// parents: deleting a parent leaves its children behind. So this plugin walks
// the parentThreadId tree itself and deletes each subtree bottom-up.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

type ThreadRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];

const threadBriefSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  busy: z.boolean(),
  archived: z.boolean(),
  /** Nesting below the thread the user picked; 0 for the picked thread. */
  depth: z.number(),
});
export type ThreadBrief = z.infer<typeof threadBriefSchema>;

const skippedSchema = threadBriefSchema.extend({ reason: z.string() });
export type SkippedThread = z.infer<typeof skippedSchema>;

const planSchema = z.object({
  /** Threads to delete, children before their parents. */
  targets: z.array(threadBriefSchema),
  skipped: z.array(skippedSchema),
});
export type DeletePlan = z.infer<typeof planSchema>;

const resultSchema = z.object({
  deleted: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
  skipped: z.array(skippedSchema),
});
export type DeleteResult = z.infer<typeof resultSchema>;

const threadIdsSchema = z.array(z.string().min(1).max(200)).min(1).max(1000);

export const rpcContract = defineRpcContract({
  plan_delete: {
    input: z
      .object({ threadIds: threadIdsSchema, withChildren: z.boolean() })
      .strict(),
    output: planSchema,
  },
  delete_threads: {
    input: z
      .object({ threadIds: threadIdsSchema, withChildren: z.boolean() })
      .strict(),
    output: resultSchema,
  },
  archive_threads: {
    input: z.object({ threadIds: threadIdsSchema }).strict(),
    output: z.object({
      archived: z.array(z.string()),
      failed: z.array(z.object({ id: z.string(), error: z.string() })),
    }),
  },
  plan_children: {
    input: z.object({ parentThreadId: z.string().min(1).max(200) }).strict(),
    output: planSchema,
  },
  delete_children: {
    input: z.object({ parentThreadId: z.string().min(1).max(200) }).strict(),
    output: resultSchema,
  },
});

const PAGE_SIZE = 500;

/** A thread is working when it runs a turn or something is still pending on it. */
function isBusy(thread: ThreadRow): boolean {
  const idle = (status: string) => status === "idle" || status === "error";
  if (!idle(thread.status) || !idle(thread.runtime.displayStatus)) return true;
  if (thread.queuedWork !== "none" || thread.hasPendingInteraction) return true;
  const { activity } = thread;
  return (
    activity.activeBackgroundAgentCount > 0 ||
    activity.activeBackgroundCommandCount > 0 ||
    activity.activeWorkflowCount > 0 ||
    activity.activeGoalCount > 0
  );
}

function busyReason(thread: ThreadRow): string {
  if (thread.hasPendingInteraction) return "waiting for your answer";
  if (thread.queuedWork !== "none") return "has queued messages";
  if (thread.status !== "idle" && thread.status !== "error") {
    return `is ${thread.status}`;
  }
  return "has background work running";
}

function titleOf(thread: ThreadRow): string {
  return thread.title ?? thread.titleFallback ?? thread.id;
}

function brief(thread: ThreadRow, depth: number): ThreadBrief {
  return {
    id: thread.id,
    title: titleOf(thread),
    status: thread.status,
    busy: isBusy(thread),
    archived: thread.archivedAt !== null,
    depth,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default async function plugin(bb: BbPluginApi) {
  async function listPages(archived: boolean): Promise<ThreadRow[]> {
    const rows: ThreadRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await bb.sdk.threads.list({
        archived,
        includeHidden: true,
        limit: PAGE_SIZE,
        offset,
      });
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  /** Every non-deleted thread, active and archived, hidden included. */
  async function loadForest() {
    const [active, archived] = await Promise.all([
      listPages(false),
      listPages(true),
    ]);
    const byId = new Map<string, ThreadRow>();
    for (const thread of [...active, ...archived]) {
      if (thread.deletedAt === null) byId.set(thread.id, thread);
    }
    const children = new Map<string, ThreadRow[]>();
    for (const thread of byId.values()) {
      if (thread.parentThreadId === null) continue;
      const siblings = children.get(thread.parentThreadId) ?? [];
      siblings.push(thread);
      children.set(thread.parentThreadId, siblings);
    }
    return { byId, children };
  }
  type Forest = Awaited<ReturnType<typeof loadForest>>;

  /** The thread and its descendants, children before parents. */
  function subtree(
    forest: Forest,
    root: ThreadRow,
  ): { thread: ThreadRow; depth: number }[] {
    const out: { thread: ThreadRow; depth: number }[] = [];
    const seen = new Set<string>();
    const visit = (thread: ThreadRow, depth: number) => {
      if (seen.has(thread.id)) return;
      seen.add(thread.id);
      for (const child of forest.children.get(thread.id) ?? []) {
        visit(child, depth + 1);
      }
      out.push({ thread, depth });
    };
    visit(root, 0);
    return out;
  }

  /**
   * Picked threads are deleted whatever their state: the user chose them.
   * With `withChildren`, their descendants go too, except working ones (and
   * the ancestors between a working descendant and the picked thread, which
   * would otherwise leave it orphaned).
   */
  function planDelete(
    forest: Forest,
    threadIds: readonly string[],
    callerThreadId: string | undefined,
    withChildren: boolean,
  ): DeletePlan {
    const targets: ThreadBrief[] = [];
    const skipped: SkippedThread[] = [];
    const planned = new Set<string>();
    const picked = new Set(threadIds);

    for (const threadId of picked) {
      const root = forest.byId.get(threadId);
      if (root === undefined) {
        skipped.push({
          id: threadId,
          title: threadId,
          status: "unknown",
          busy: false,
          archived: false,
          depth: 0,
          reason: "not found",
        });
        continue;
      }
      // A picked descendant of another picked thread is handled with it.
      let ancestorId = root.parentThreadId;
      let coveredByAncestor = false;
      while (withChildren && ancestorId !== null) {
        if (picked.has(ancestorId)) {
          coveredByAncestor = true;
          break;
        }
        ancestorId = forest.byId.get(ancestorId)?.parentThreadId ?? null;
      }
      if (coveredByAncestor) continue;

      const nodes = withChildren
        ? subtree(forest, root)
        : [{ thread: root, depth: 0 }];
      const blocked = new Set<string>();
      for (const { thread, depth } of nodes) {
        const isPicked = picked.has(thread.id);
        const hasBlockedChild = (forest.children.get(thread.id) ?? []).some(
          (child) => blocked.has(child.id),
        );
        if (thread.id === callerThreadId) {
          blocked.add(thread.id);
          skipped.push({
            ...brief(thread, depth),
            reason: "is the thread running this command",
          });
        } else if (!isPicked && isBusy(thread)) {
          blocked.add(thread.id);
          skipped.push({ ...brief(thread, depth), reason: busyReason(thread) });
        } else if (!isPicked && hasBlockedChild) {
          blocked.add(thread.id);
          skipped.push({
            ...brief(thread, depth),
            reason: "has a working child",
          });
        } else if (!planned.has(thread.id)) {
          planned.add(thread.id);
          targets.push(brief(thread, depth));
        }
      }
    }
    return { targets, skipped };
  }

  /** Every direct child whose whole subtree is idle. */
  function planChildren(
    forest: Forest,
    parentThreadId: string,
    callerThreadId: string | undefined,
  ): DeletePlan {
    const targets: ThreadBrief[] = [];
    const skipped: SkippedThread[] = [];
    for (const child of forest.children.get(parentThreadId) ?? []) {
      const nodes = subtree(forest, child);
      const working = nodes.find(
        ({ thread }) => thread.id === callerThreadId || isBusy(thread),
      );
      if (working === undefined) {
        targets.push(
          ...nodes.map(({ thread, depth }) => brief(thread, depth)),
        );
        continue;
      }
      const reason =
        working.thread.id === callerThreadId
          ? "contains the thread running this command"
          : working.thread.id === child.id
            ? busyReason(child)
            : `has a working child (${titleOf(working.thread)} ${busyReason(working.thread)})`;
      skipped.push({ ...brief(child, 0), reason });
    }
    return { targets, skipped };
  }

  async function execute(plan: DeletePlan): Promise<DeleteResult> {
    const deleted: string[] = [];
    const failed: DeleteResult["failed"] = [];
    // Sequential and children first: each delete sees its subtree already gone.
    for (const target of plan.targets) {
      try {
        await bb.sdk.threads.delete({
          threadId: target.id,
          childThreadsConfirmed: true,
        });
        deleted.push(target.id);
      } catch (cause) {
        failed.push({ id: target.id, error: errorMessage(cause) });
      }
    }
    if (deleted.length > 0) {
      bb.log.info(`deleted ${deleted.length} thread(s): ${deleted.join(", ")}`);
    }
    return { deleted, failed, skipped: plan.skipped };
  }

  async function requireThread(forest: Forest, threadId: string) {
    const thread = forest.byId.get(threadId);
    if (thread === undefined) {
      throw new PluginCliError(`thread ${threadId} not found`, {
        code: "thread_not_found",
        hint: "Run `bb thread list` to see thread ids.",
      });
    }
    return thread;
  }

  bb.rpc.register(rpcContract, {
    plan_delete: async ({ threadIds, withChildren }) =>
      planDelete(await loadForest(), threadIds, undefined, withChildren),
    delete_threads: async ({ threadIds, withChildren }) =>
      execute(planDelete(await loadForest(), threadIds, undefined, withChildren)),
    archive_threads: async ({ threadIds }) => {
      const archived: string[] = [];
      const failed: { id: string; error: string }[] = [];
      for (const threadId of new Set(threadIds)) {
        try {
          await bb.sdk.threads.archive({ threadId });
          archived.push(threadId);
        } catch (cause) {
          failed.push({ id: threadId, error: errorMessage(cause) });
        }
      }
      return { archived, failed };
    },
    plan_children: async ({ parentThreadId }) =>
      planChildren(await loadForest(), parentThreadId, undefined),
    delete_children: async ({ parentThreadId }) =>
      execute(planChildren(await loadForest(), parentThreadId, undefined)),
  });

  // CLI output.

  function planText(plan: DeletePlan, verb: string): string {
    const lines: string[] = [];
    if (plan.targets.length === 0) {
      lines.push(`Nothing to ${verb}.`);
    } else {
      lines.push(`Will ${verb} ${plan.targets.length} thread(s):`);
      // Show parents above their children, as the sidebar does.
      for (const target of [...plan.targets].reverse()) {
        const state = target.archived ? `${target.status}, archived` : target.status;
        lines.push(`${"  ".repeat(target.depth + 1)}${target.id}  ${target.title}  [${state}]`);
      }
    }
    if (plan.skipped.length > 0) {
      lines.push(`Keeping ${plan.skipped.length}:`);
      for (const item of plan.skipped) {
        lines.push(`  ${item.id}  ${item.title}  (${item.reason})`);
      }
    }
    return lines.join("\n");
  }

  function resultText(result: DeleteResult): string {
    const lines = [`Deleted ${result.deleted.length} thread(s).`];
    for (const item of result.failed) {
      lines.push(`Failed ${item.id}: ${item.error}`);
    }
    for (const item of result.skipped) {
      lines.push(`Kept ${item.id}  ${item.title}  (${item.reason})`);
    }
    return lines.join("\n");
  }

  function respond(
    json: boolean,
    payload: { plan: DeletePlan; result: DeleteResult | null },
  ) {
    const failed = payload.result !== null && payload.result.failed.length > 0;
    if (json) {
      return {
        exitCode: failed ? 1 : 0,
        stdout: JSON.stringify({
          dryRun: payload.result === null,
          targets: payload.plan.targets,
          ...(payload.result ?? { skipped: payload.plan.skipped }),
        }),
      };
    }
    if (payload.result === null) {
      const hint =
        payload.plan.targets.length > 0 ? "\nRerun with --yes to delete." : "";
      return { exitCode: 0, stdout: planText(payload.plan, "delete") + hint };
    }
    return { exitCode: failed ? 1 : 0, stdout: resultText(payload.result) };
  }

  const yesOption = {
    type: "boolean",
    description:
      "Delete for real. Without it the command only prints what it would delete",
    aliases: ["confirm", "force"],
  } as const;
  const jsonOption = {
    type: "boolean",
    description: "Emit machine-readable JSON",
  } as const;

  bb.cli.register(
    defineCli({
      name: "bulk-delete",
      summary: "Delete several threads at once, or every idle child of a thread",
      description:
        "Deletion is permanent. Every command previews by default; add --yes to delete. " +
        "A thread counts as working while it runs a turn, waits for an answer, has queued messages, or runs background agents, commands, workflows, or goals; working threads are kept.",
      commands: {
        children: cliCommand({
          summary:
            "Delete the idle child threads of a parent (with their own children); working ones stay",
          options: {
            thread: {
              type: "string",
              description: "Parent thread id; defaults to the thread running the command",
              aliases: ["thread-id", "parent"],
              placeholder: "thread-id",
            },
            yes: yesOption,
            json: jsonOption,
          },
          async run({ options }, ctx) {
            const parentThreadId = options.thread ?? ctx.threadId;
            if (parentThreadId === undefined) {
              throw new PluginCliError("no parent thread given", {
                code: "thread_required",
                hint: "Run it from a bb thread or pass --thread <thread-id>.",
              });
            }
            const forest = await loadForest();
            await requireThread(forest, parentThreadId);
            const plan = planChildren(forest, parentThreadId, ctx.threadId);
            const result = options.yes ? await execute(plan) : null;
            return respond(options.json, { plan, result });
          },
        }),
        threads: cliCommand({
          summary: "Delete the given threads",
          positionals: [
            {
              name: "ids",
              description: "Thread ids to delete",
              required: true,
              variadic: true,
            },
          ],
          options: {
            "with-children": {
              type: "boolean",
              description:
                "Also delete their child threads; working children (and their ancestors) are kept",
              aliases: ["recursive", "children"],
            },
            yes: yesOption,
            json: jsonOption,
          },
          async run({ positionals, options }, ctx) {
            const forest = await loadForest();
            for (const threadId of positionals.ids) {
              await requireThread(forest, threadId);
            }
            const plan = planDelete(
              forest,
              positionals.ids,
              ctx.threadId,
              options["with-children"],
            );
            const result = options.yes ? await execute(plan) : null;
            return respond(options.json, { plan, result });
          },
        }),
      },
    }),
  );
}
