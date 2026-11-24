import type { BbPluginApi } from "@get-bb/plugin-sdk";

const skillName = "work-delegation";

const delegationPolicy =
  "The user has enabled default delegation for bounded units of their current request. For substantial work, use the work-delegation skill before opening large sources or starting execution. Delegate research, bulk reading, implementation, and noisy validation even when one worker can do the whole job. Run independent units in parallel and dependent units in order. Use an available native subagent or a parented BB thread within the task scope and existing permissions. In the main thread keep the goal, milestone status, decisions, and accepted results. Ask workers for up to five lines with the outcome, evidence of verification, any blocker, and links. Keep raw logs, large diffs, and intermediate materials in the worker thread or artifacts. Handle quick tasks directly and follow any explicit request to work inline.";

const assignedWorkPolicy =
  "When you are executing a brief from your parent, own the assigned work and report the result in up to five lines. Start another worker only when the brief explicitly asks you to. For work assigned directly by the user, apply the delegation rule below.";

export default function plugin(bb: BbPluginApi) {
  bb.agents.configure(({ thread }) => ({
    tools: [],
    skills: [skillName],
    instructions: thread.parentThreadId === null
      ? delegationPolicy
      : [assignedWorkPolicy, delegationPolicy].join("\n\n"),
  }));
}
