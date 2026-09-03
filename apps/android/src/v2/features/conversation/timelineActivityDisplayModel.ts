import type { V2Item, V2ItemLifecycle } from "@codewide/sync-client/v2";

import type { TimelineDisplayActivity } from "../../presentation/conversation/timelineTypes";

export function activityDisplayModel(item: V2Item): TimelineDisplayActivity[] {
  const activity = activityForItem(item);
  return activity === null ? [] : [activity];
}

export function lifecycleActivityDisplayModel(
  lifecycle: V2ItemLifecycle,
): TimelineDisplayActivity[] {
  const activity = activityForItem(lifecycle.item);
  if (activity === null) return [];
  return [
    {
      ...activity,
      state: lifecycle.phase === "started" ? "running" : completedLifecycleState(activity.state),
    },
  ];
}

function activityForItem(item: V2Item): TimelineDisplayActivity | null {
  switch (item.kind) {
    case "userMessage":
    case "assistantText":
      return null;
    case "reasoning":
      return {
        contentParts: item.contentParts ?? [],
        id: item.id,
        kind: "reasoning",
        label: "Thinking",
        state: "completed",
        summary: item.summary,
        summaryParts: item.summaryParts ?? [],
      };
    case "command":
      return {
        command: item.command,
        cwd: item.cwd,
        durationMs: item.durationMs ?? null,
        exitCode: item.exitCode,
        id: item.id,
        kind: "command",
        label: "Command",
        output: item.outputPreview,
        state: item.status,
      };
    case "fileChange":
      return {
        change: item.change,
        changes: item.changes ?? [],
        id: item.id,
        kind: "fileChange",
        label: "Changes",
        path: item.path,
        state: item.status,
      };
    case "tool":
      return {
        appContext:
          item.appContext === undefined || item.appContext === null
            ? null
            : {
                actionName: item.appContext.actionName ?? null,
                appName: item.appContext.appName ?? null,
                connectorId: item.appContext.connectorId,
                linkId: item.appContext.linkId ?? null,
                resourceUri: item.appContext.resourceUri ?? null,
              },
        argumentsJson: item.argumentsJson ?? null,
        durationMs: item.durationMs ?? null,
        error: item.error?.message ?? null,
        id: item.id,
        kind: "tool",
        label: item.name,
        name: item.name,
        pluginId: item.pluginId ?? null,
        readOnlyHint: item.readOnlyHint ?? null,
        resultJson: item.resultJson ?? null,
        server: item.server ?? null,
        state: item.status,
        success: item.success ?? null,
        summary: item.summary,
      };
    case "plan":
      return {
        id: item.id,
        kind: "plan",
        label: "Plan",
        state: planState(item.steps),
        steps: item.steps,
        text: item.text ?? null,
      };
    case "attachment":
      return {
        attachment: item.attachment,
        id: item.id,
        kind: "attachment",
        label: "Attachment",
        state: "completed",
      };
    case "hookPrompt":
      return {
        fragments: item.fragments,
        id: item.id,
        kind: "hookPrompt",
        label: "Hook prompt",
        state: "completed",
      };
    case "collaboration":
      return {
        agentsStatesJson: item.agentsStatesJson ?? null,
        effort: item.effort,
        id: item.id,
        kind: "collaboration",
        label: collaborationLabel(item.tool),
        model: item.model,
        prompt: item.prompt,
        receiverThreadIds: item.receiverThreadIds,
        senderThreadId: item.senderThreadId,
        state: item.status,
        tool: item.tool,
      };
    case "subagentActivity":
      return {
        activityKind: item.activityKind,
        agentPath: item.agentPath,
        agentThreadId: item.agentThreadId,
        id: item.id,
        kind: "subagentActivity",
        label: "Subagent",
        state: "completed",
      };
    case "webSearch":
      return {
        actionJson: item.actionJson ?? null,
        id: item.id,
        kind: "webSearch",
        label: "Web search",
        query: item.query,
        resultsJson: item.resultsJson ?? null,
        state: "completed",
      };
    case "imageView":
      return {
        id: item.id,
        kind: "imageView",
        label: "Viewed image",
        path: item.path,
        sourceUrl: item.sourceUrl,
        state: "completed",
      };
    case "sleep":
      return {
        durationMs: item.durationMs,
        id: item.id,
        kind: "sleep",
        label: "Waited",
        state: "completed",
      };
    case "imageGeneration":
      return {
        id: item.id,
        kind: "imageGeneration",
        label: "Generated image",
        prompt: item.prompt,
        result: item.result,
        savedPath: item.savedPath,
        sourceUrl: item.sourceUrl,
        state: item.status,
      };
    case "reviewMode":
      return {
        id: item.id,
        kind: "reviewMode",
        label: "Review mode",
        review: item.review,
        reviewState: item.state,
        state: "completed",
      };
    case "contextCompaction":
      return {
        id: item.id,
        kind: "contextCompaction",
        label: "Context compacted",
        state: "completed",
      };
    case "unsupported":
      return {
        id: item.id,
        kind: "unsupported",
        label: item.sourceKind,
        payloadJson: item.payloadJson,
        payloadTruncated: item.payloadTruncated,
        sourceKind: item.sourceKind,
        state: "completed",
      };
    default:
      return unreachableItem(item);
  }
}

function collaborationLabel(tool: string): string {
  return tool === "" ? "Collaboration" : `Collaboration · ${tool}`;
}

function completedLifecycleState(
  state: TimelineDisplayActivity["state"],
): TimelineDisplayActivity["state"] {
  if (state === "failed" || state === "rejected") return state;
  return "completed";
}

function planState(
  steps: Extract<V2Item, { kind: "plan" }>["steps"],
): TimelineDisplayActivity["state"] {
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.length > 0 && steps.every((step) => step.status === "completed")) return "completed";
  return "pending";
}

function unreachableItem(_item: never): null {
  return null;
}
