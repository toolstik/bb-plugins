---
name: work-delegation
description: Delegate substantial BB work before large reads, research, implementation, or noisy validation. Give bounded work to isolated agents and keep the main thread's context small.
---

# Work delegation

Delegate as soon as you can state a useful brief. Use one worker for a single substantial task, parallel workers for independent units, and a sequence for tasks that use each other's results. Keep writing targets separate or give overlapping edits to one worker. Handle quick clarifications and bounded lookups in the main thread.

## Start the work

- Give each worker the goal, relevant paths or sources, user constraints, write boundaries, success criteria, and checks to run. Include only the background that task needs. In BB, write briefs to workers in English and ask them to follow the user's language and style for deliverables.
- Use the provider's native subagent tool when available and allowed. Otherwise start a child with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --title "<short task>" --prompt-file <brief-path>`. Use the parent's environment for shared state or read-only work. When separate writers need isolated Git worktrees, use `--new-environment worktree` in place of `--environment` and specify how their results will be integrated.
- Keep the user's scope and permissions in every handoff. Ask a worker to delegate further only when its brief calls for it. If neither mechanism can run, keep the user informed and carry on with bounded reads and summarized tool output where authorized.

## Handle results

- Ask for up to five lines covering the outcome, decisive evidence or checks, any blocker or decision, and links or paths to deliverables. Keep full reports, logs, and diffs in the worker thread or in artifacts.
- Run useful independent work while workers run. Use the final BB child notification as the report. When your next step depends on a worker, use `bb thread wait <id>` and `bb thread output <id>` to collect the result if it has not arrived. Inspect a specific artifact or log excerpt when needed for a decision.
- Keep the goal, milestone status, decisions, and accepted results in the main thread. Verify the combined outcome against the user's request and give them the finished deliverable.
