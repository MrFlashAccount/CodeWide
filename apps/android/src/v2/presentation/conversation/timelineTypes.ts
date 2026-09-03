type TimelineActivityState =
  | "applied"
  | "completed"
  | "failed"
  | "pending"
  | "rejected"
  | "running";

interface TimelineActivityBase {
  id: string;
  label: string;
  state: TimelineActivityState;
}

export interface TimelineActivityAttachment {
  downloadUrl: string | null;
  id: string;
  mediaType: string;
  name: string;
  sizeBytes: string;
}

interface TimelineDisplayUserTextElement {
  byteRange: { end: number; start: number };
  placeholder: string | null;
}

interface TimelineDisplayUserMediaBase {
  attachment: TimelineActivityAttachment | null;
  reference: string;
}

export type TimelineDisplayUserBlock =
  | { kind: "text"; text: string; textElements: TimelineDisplayUserTextElement[] }
  | (TimelineDisplayUserMediaBase & {
      detail: "auto" | "high" | "low" | "original" | null;
      kind: "image" | "localImage";
    })
  | (TimelineDisplayUserMediaBase & { kind: "audio" | "localAudio" })
  | { kind: "skill"; name: string; path: string }
  | (TimelineDisplayUserMediaBase & { kind: "mention"; name: string; path: string });

interface TimelineActivityFileChange {
  change: "add" | "delete" | "update";
  diff?: string;
  path: string;
}

interface TimelineActivityPlanStep {
  status: "completed" | "pending" | "running";
  text: string;
}

interface TimelineToolAppContext {
  actionName: string | null;
  appName: string | null;
  connectorId: string;
  linkId: string | null;
  resourceUri: string | null;
}

export interface TimelineMemoryCitationEntry {
  lineEnd: number;
  lineStart: number;
  note: string;
  path: string;
}

export interface TimelineMemoryCitation {
  entries: TimelineMemoryCitationEntry[];
  threadIds: string[];
}

export type TimelineDisplayResponseRow =
  | {
      id: string;
      kind: "assistant";
      memoryCitation: TimelineMemoryCitation | null;
      text: string;
    }
  | { activity: TimelineDisplayActivity; id: string; kind: "activity" };

export type TimelineDisplayActivity =
  | (TimelineActivityBase & {
      contentParts: string[];
      kind: "reasoning";
      summary: string;
      summaryParts: string[];
    })
  | (TimelineActivityBase & {
      command: string;
      cwd: string;
      durationMs: number | null;
      exitCode: number | null;
      kind: "command";
      output: string;
    })
  | (TimelineActivityBase & {
      change: "add" | "delete" | "update";
      changes: TimelineActivityFileChange[];
      kind: "fileChange";
      path: string;
    })
  | (TimelineActivityBase & {
      appContext: TimelineToolAppContext | null;
      argumentsJson: string | null;
      durationMs: number | null;
      error: string | null;
      kind: "tool";
      name: string;
      pluginId: string | null;
      readOnlyHint: boolean | null;
      resultJson: string | null;
      server: string | null;
      success: boolean | null;
      summary: string;
    })
  | (TimelineActivityBase & {
      kind: "plan";
      steps: TimelineActivityPlanStep[];
      text: string | null;
    })
  | (TimelineActivityBase & {
      attachment: TimelineActivityAttachment;
      kind: "attachment";
    })
  | (TimelineActivityBase & { fragments: string[]; kind: "hookPrompt" })
  | (TimelineActivityBase & {
      agentsStatesJson: string | null;
      effort: "high" | "low" | "max" | "medium" | "minimal" | "none" | "ultra" | "xhigh" | null;
      kind: "collaboration";
      model: string | null;
      prompt: string | null;
      receiverThreadIds: string[];
      senderThreadId: string | null;
      tool: string;
    })
  | (TimelineActivityBase & {
      activityKind: string;
      agentPath: string[];
      agentThreadId: string;
      kind: "subagentActivity";
    })
  | (TimelineActivityBase & {
      actionJson: string | null;
      kind: "webSearch";
      query: string;
      resultsJson: string | null;
    })
  | (TimelineActivityBase & { kind: "imageView"; path: string; sourceUrl: string })
  | (TimelineActivityBase & { durationMs: number; kind: "sleep" })
  | (TimelineActivityBase & {
      kind: "imageGeneration";
      prompt: string;
      result: string;
      savedPath: string | null;
      sourceUrl: string | null;
    })
  | (TimelineActivityBase & {
      kind: "reviewMode";
      review: string | null;
      reviewState: "entered" | "exited";
    })
  | (TimelineActivityBase & { kind: "contextCompaction" })
  | (TimelineActivityBase & {
      kind: "unsupported";
      payloadJson: string;
      payloadTruncated: boolean;
      sourceKind: string;
    });

type TimelineDisplayLifecycle = TimelineDisplayActivity;

export interface TimelineActivityActions {
  onCopyUnsupported?(payloadJson: string): Promise<void> | void;
  onFixUnsupported?(sourceKind: string, payloadJson: string): Promise<void> | void;
  onOpenAttachment?(attachment: TimelineActivityAttachment): Promise<void> | void;
  onOpenItemOutput?(turnId: string, itemId: string): Promise<void> | void;
  onOpenSubagent?(threadId: string): Promise<void> | void;
}

export interface TimelineDisplayTurn {
  activityCount: number;
  activities: TimelineDisplayActivity[];
  assistantItemId?: string;
  assistantText: string[];
  completedAt: string | null;
  createdAt: string | null;
  durationMs: number | null;
  id: string;
  lifecycle: TimelineDisplayLifecycle[];
  responseRows: TimelineDisplayResponseRow[];
  state: "completed" | "failed" | "interrupted" | "queued" | "running";
  usage: TimelineDisplayUsage | null;
  userInput: TimelineDisplayUserBlock[];
  userText: string[];
}

interface TimelineDisplayUsage {
  inputTokens: number;
  latestRequestTokens: number;
  modelContextWindow: number | null;
  outputTokens: number;
  threadInputTokens: number;
  threadOutputTokens: number;
  threadTotalCostUsd: number | null;
  threadTotalTokens: number;
  totalCostUsd: number | null;
}

export interface TimelineTurnActions {
  onEdit?(): Promise<void> | void;
  onFork?(): Promise<void>;
  onInterrupt?(): Promise<void>;
  onReview?(): Promise<void> | void;
  onRollback?(): Promise<void>;
}

export type TimelineTurnActionsResolver = (
  turn: TimelineDisplayTurn,
) => TimelineTurnActions | undefined;
