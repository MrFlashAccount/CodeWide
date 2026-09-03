import type { AppiumBrowser } from "./ui.ts";

export type InteractionInventoryRowId =
  | "INT-01"
  | "INT-02"
  | "INT-03"
  | "INT-04"
  | "INT-05"
  | "INT-06"
  | "INT-07"
  | "INT-08";

export interface InteractionInventoryAlias {
  assertExactState(): Promise<void>;
  rowId: InteractionInventoryRowId;
  state: string;
}

export interface InteractionInventorySource {
  driver: AppiumBrowser;
  pageSource: string;
  sourceRowId: string;
  sourceState: string;
}

export interface CaptureInteractionInventoryRow {
  (rowId: string, state: string, assertExactState: () => Promise<void>): Promise<void>;
}

export interface PressedInteractionInventorySource extends InteractionInventorySource {
  capture: CaptureInteractionInventoryRow;
}

export interface InteractionInventoryCapture {
  rowId: string;
  state: string;
}

type InteractionKind = "default" | "disabled" | "focused" | "selected";
type InteractionLayout = "phone" | "wide";
type NodeAttribute = "enabled" | "focused" | "selected";
type OverlayKind = "dialog" | "popover" | "sheet";

interface NodeExpectation {
  attribute?: NodeAttribute;
  match?: "exact" | "markup" | "prefix";
  token: string;
  value?: "false" | "true";
}

interface ControlInventorySpec {
  expectation: NodeExpectation;
  kind: InteractionKind;
  layouts: readonly InteractionLayout[];
  sourceRowId: string;
  surface: string;
}

interface OverlayInventorySpec {
  backgroundToken: string;
  foregroundToken: string;
  kind: OverlayKind;
  layouts: readonly InteractionLayout[];
  sourceRowId: string;
  surface: string;
}

interface PendingAliasInventorySpec {
  action: string;
  expectation: NodeExpectation;
  layouts: readonly InteractionLayout[];
  sourceRowId: string;
  sourceStateSuffix: string;
}

interface AsyncActionInventorySpec {
  action: string;
  classification: "lifecycle-pending" | "promise-pending";
  layouts: readonly InteractionLayout[];
}

interface DedicatedPressedActionInventorySpec {
  layouts: readonly InteractionLayout[];
  surface: string;
}

interface SynchronousActionInventorySpec {
  action: string;
  classification: "synchronous";
  reason: "local-selection" | "native-picker" | "navigation" | "presentation";
}

interface AndroidBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface XmlElementNode {
  children: XmlElementNode[];
  openTag: string;
  parent: XmlElementNode | null;
}

const PHONE_AND_WIDE: readonly InteractionLayout[] = ["phone", "wide"];
const PHONE_ONLY: readonly InteractionLayout[] = ["phone"];
const WIDE_ONLY: readonly InteractionLayout[] = ["wide"];

// This is deliberately an explicit inventory. Adding an exercised interactive surface to the
// parity harness without classifying it here must remain a visible review decision.
const CONTROL_INVENTORY: readonly ControlInventorySpec[] = [
  control("LIST-04", "new-thread", "default", "New thread"),
  control("LIST-05", "thread-list-menu", "default", "Thread list menu"),
  control("NAV-07", "server-selector-trigger", "default", "Choose server", PHONE_ONLY),
  control("NAV-08", "server-selector-all", "default", "All servers", PHONE_ONLY),
  control("NAV-08", "server-selector-saved", "default", "CodeWide E2E, Live", PHONE_ONLY),
  control("NAV-11", "server-selector-live", "default", "CodeWide E2E, Live", PHONE_ONLY),
  control("RAIL-01", "rail-live-server", "default", "CodeWide E2E, Live", WIDE_ONLY),
  control("NAV-18", "server-selector-add-server", "default", "Add server", PHONE_ONLY),
  control("NAV-19", "server-selector-settings", "default", "Settings", PHONE_ONLY),
  control("RAIL-08", "rail-add-server", "default", "Add server", WIDE_ONLY),
  control("RAIL-09", "rail-settings", "default", "Settings", WIDE_ONLY),
  control("HEADER-05", "conversation-search", "default", "Search in thread"),
  control("HEADER-07", "conversation-context", "default", "Context usage and account limits"),
  control("HEADER-09", "conversation-thread-menu", "default", "Thread menu"),
  control("MSG-11", "message-actions", "default", "Message actions"),
  control("HEADER-02", "conversation-back", "default", "Back to threads", PHONE_ONLY),
  control("SEARCH-06", "conversation-search-close", "default", "Close thread search"),
  control("INPUT-06", "composer-send", "default", "Send message"),
  control("INPUT-08", "stop-response", "default", "Stop response"),
  control("MENU-02", "composer-attach-file", "default", "Attach file"),
  control("MENU-03", "composer-drawing", "default", "Drawing"),
  control("MENU-04", "composer-terminal", "default", "Terminal"),
  control("MENU-05", "composer-port-forward", "default", "Port forward"),
  control("MENU-06", "composer-skills", "default", "Skills"),
  control("MENU-07", "composer-goal", "default", "Goal"),
  prefixControl("DRAFT-02", "draft-remove-image", "Remove"),
  prefixControl("DRAFT-03", "draft-remove-file", "Remove"),
  prefixControl("DRAFT-05", "draft-edit-attachment", "Edit"),
  control("QUEUE-02", "queue-edit", "default", "Edit queued prompt"),
  control("QUEUE-02", "queue-delete", "default", "Delete queued prompt"),
  control("QUEUE-02", "queue-steer", "default", "Steer queued prompt"),
  control("VOICE-01", "voice-input", "default", "Voice input"),
  control("VOICE-05", "voice-retry", "default", "Retry voice transcription"),
  control("REQ-01", "approval-accept-once", "default", "Accept once"),
  control("REQ-01", "approval-decline", "default", "Decline"),
  control("REQ-02", "approval-queue-decline", "default", "Decline"),
  control("REQ-03", "user-question-alpha", "default", "Alpha"),
  control("REQ-03", "user-question-beta", "default", "Beta"),
  control("REQ-04", "elicitation-yes", "default", "Yes"),
  control("REQ-04", "elicitation-no", "default", "No"),
  control("REQ-04", "elicitation-decline", "default", "Decline"),
  control("ATT-03", "attachment-open", "default", "Open attachment", WIDE_ONLY),
  control("CHG-06", "changes-review", "default", "Review", WIDE_ONLY),
  control("TERM-03", "terminal-minimize", "default", "Minimize terminal", WIDE_ONLY),
  control("PORT-03", "ports-refresh", "default", "Refresh open ports"),
  prefixControl("PORT-03", "port-forward", "Forward "),
  prefixControl("AGENT-03", "subagent-open", "Open subagent "),
  prefixControl("NEW-01", "new-thread-project", "Change project, currently ", WIDE_ONLY),
  prefixControl("NEW-02", "new-thread-workspace-mode", "Workspace mode, ", WIDE_ONLY),
  prefixControl("NEW-03", "new-thread-model-thinking", "Model and thinking: ", WIDE_ONLY),
  prefixControl("NEW-03", "new-thread-permissions", "Permissions: ", WIDE_ONLY),
  control("SET-01", "settings-close", "default", "Close server settings", WIDE_ONLY),
  control("SET-02", "saved-server-actions", "default", "Actions for CodeWide E2E", WIDE_ONLY),

  control("LIST-06", "thread-list-archived", "default", "Archived threads"),
  control("LIST-06", "thread-list-manage-accounts", "default", "Manage accounts"),
  control("FILTER-01", "thread-filter-trigger", "default", "Thread filters"),
  control("FILTER-01", "thread-filter-running-item", "default", "Running"),
  control("FILTER-01", "thread-filter-approval-item", "default", "Approval needed"),
  control("FILTER-01", "thread-filter-unread-item", "default", "Unread"),
  control("FILTER-01", "thread-filter-pinned-item", "default", "Pinned"),
  prefixControl("ROW-01", "thread-row-open", "Open thread "),
  prefixControl("ROW-02", "thread-row-open-running", "Open thread "),
  prefixControl("ROW-03", "thread-row-open-approval", "Open thread "),
  prefixControl("ROW-04", "thread-row-open-input", "Open thread "),
  prefixControl("ROW-05", "thread-row-open-failed", "Open thread "),
  prefixControl("ROW-06", "thread-row-open-unread", "Open thread "),
  prefixControl("ROW-09", "thread-row-open-retained", "Open thread "),
  control("ROW-10", "thread-row-copy-id", "default", "Copy session ID"),
  control("ROW-10", "thread-row-pin", "default", "Pin"),
  control("ROW-10", "thread-row-mark-read", "default", "Mark as read"),
  control("ROW-10", "thread-row-archive", "default", "Archive"),
  control("ROW-11", "thread-swipe-pin", "default", "Pin thread", PHONE_ONLY),
  control("ROW-11", "thread-swipe-read", "default", "Read thread", PHONE_ONLY),
  control("ROW-11", "thread-swipe-archive", "default", "Archive thread", PHONE_ONLY),
  control("LIST-18", "archived-back", "default", "Back to threads"),
  control("LIST-21", "catalog-page", "default", "Load more search results"),
  control("LIST-21", "catalog-page-retry", "default", "Retry loading threads"),
  control("SEARCH-04", "conversation-search-previous", "default", "Previous thread match", WIDE_ONLY),
  control("SEARCH-05", "conversation-search-next", "default", "Next thread match", WIDE_ONLY),
  control("HEADER-10", "thread-menu-copy-id", "default", "Copy session ID"),
  control("HEADER-10", "thread-menu-rename", "default", "Rename"),
  control("HEADER-10", "thread-menu-pin", "default", "Pin thread"),
  control("HEADER-10", "thread-menu-fork", "default", "Fork thread"),
  control("HEADER-10", "thread-menu-compact", "default", "Compact context"),
  control("HEADER-10", "thread-menu-archive", "default", "Archive thread"),
  control("HEADER-10", "thread-menu-delete", "default", "Delete thread"),
  control("MSG-12", "message-copy", "default", "Copy"),
  control("MSG-12", "message-edit", "default", "Edit message"),
  control("MSG-12", "message-fork", "default", "Fork"),
  control("MSG-12", "message-rollback", "default", "Roll back to here"),
  control("MSG-12", "message-review", "default", "Review response"),
  control("MSG-12", "message-stop", "default", "Stop response"),
  prefixControl("LIFE-02", "reasoning-activity-expand", "Expand activity "),
  prefixControl("LIFE-03", "reasoning-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-04", "tool-activity-expand", "Expand activity "),
  prefixControl("LIFE-05", "tool-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-06", "command-activity-expand", "Expand activity "),
  prefixControl("LIFE-07", "command-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-08", "failed-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-09", "plan-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-10", "subagent-activity-collapse", "Collapse activity "),
  prefixControl("LIFE-11", "authoritative-attachment-open", "Open attachment "),
  prefixControl("TURN-05", "turn-cost-trigger", "Estimated API-equivalent cost "),
  prefixControl("PAGE-04", "jump-latest", "Jump to latest"),
  prefixControl("PAGE-05", "jump-latest-unread", "Jump to latest"),
  prefixControl("CTX-01", "model-thinking-chip", "Model and thinking: "),
  prefixControl("CTX-03", "permissions-chip", "Permissions: "),
  prefixControl("CTX-05", "changes-chip", "Changes · ", WIDE_ONLY),
  prefixControl("CTX-07", "attachments-chip", "Attachments · ", WIDE_ONLY),
  prefixControl("CTX-08", "ports-chip", "Ports: "),
  prefixControl("CTX-09", "terminals-chip", "Terminals: ", WIDE_ONLY),
  prefixControl("CTX-10", "subagents-chip", "Subagents: "),
  control("MENU-01", "composer-menu-trigger", "default", "Composer menu"),
  prefixControl("QUEUE-01", "queue-open", "Open queued prompts, "),
  control("QUEUE-02", "queue-close", "default", "Close queued prompts"),
  control("QUEUE-03", "queue-cancel-edit", "default", "Cancel queued prompt edit"),
  control("QUEUE-03", "queue-save-edit", "default", "Save queued prompt"),
  control("QUEUE-03", "queue-editor-attach-file", "default", "Attach file"),
  control("QUEUE-03", "queue-editor-attach-image", "default", "Attach image"),
  control("VOICE-03", "voice-cancel", "default", "Cancel voice input"),
  control("VOICE-03", "voice-finish-insert", "default", "Stop voice input and insert transcript"),
  control("VOICE-04", "voice-finish-send", "default", "Finish voice input and send transcript"),
  control("ATT-01", "attachments-close", "default", "Close attachments"),
  control("ATT-03", "attachments-refresh", "default", "Refresh session resources", WIDE_ONLY),
  control("ATT-05", "preview-close", "default", "Close attachment", WIDE_ONLY),
  control("ATT-05", "preview-save", "default", "Save attachment", WIDE_ONLY),
  control("ATT-05", "preview-external", "default", "Open attachment in another app", WIDE_ONLY),
  control("ATT-05", "document-menu", "default", "Document reader actions", WIDE_ONLY),
  control("ATT-06", "image-preview-close", "default", "Close attachment"),
  control("ATT-06", "image-preview-save", "default", "Save attachment"),
  control("ATT-06", "image-preview-annotate", "default", "Annotate image"),
  control("ATT-09", "attachment-retry", "default", "Retry attachment action"),
  control("CHG-01", "changes-close", "default", "Close changes"),
  control("CHG-02", "changes-refresh", "default", "Refresh changes"),
  control("CHG-03", "change-scope-last-turn", "default", "Last turn", WIDE_ONLY),
  control("CHG-04", "change-open", "default", "Open change ", WIDE_ONLY),
  control("TERM-01", "terminal-new-tab", "default", "New terminal tab"),
  control("TERM-01", "terminal-minimize-active", "default", "Minimize terminal"),
  control("TERM-07", "terminal-retry-replay", "default", "Retry terminal after replay loss"),
  prefixControl("TERM-07", "terminal-close-tab", "Close "),
  control("PORT-02", "ports-close", "default", "Close ports", WIDE_ONLY),
  control("PORT-04", "browser-close", "default", "Close browser"),
  control("PORT-05", "tunnel-close", "default", "Close localhost preview"),
  control("PORT-07", "browser-reload", "default", "Reload"),
  control("PORT-07", "browser-reconnect", "default", "Reconnect"),
  control("AGENT-03", "agents-back", "default", "Back to conversation"),
  control("AGENT-04", "agent-detail-back", "default", "Back to threads", PHONE_ONLY),
  control("NEW-01", "new-thread-back", "default", "Back to threads", WIDE_ONLY),
  control("PAIR-01", "pairing-back", "default", "Back to connection methods"),
  control("PAIR-01", "pairing-close", "default", "Close server pairing"),
  control("PAIR-02", "scanner-close", "default", "Close QR scanner", PHONE_ONLY),
  control("PAIR-05", "pairing-invalid-close", "default", "Close server pairing"),
  control("PAIR-06", "pairing-failure-close", "default", "Close server pairing"),
  control("PAIR-06", "pairing-connect-retry", "default", "Connect server"),
  control("SET-01", "settings-biometric", "default", "Biometric app lock", WIDE_ONLY),
  control("SET-01", "settings-use-v2", "default", "Use V2 interface", WIDE_ONLY),
  control("SET-01", "settings-use-legacy", "default", "Use legacy interface", WIDE_ONLY),
  control("SET-01", "settings-enable-server", "default", "Enable CodeWide E2E", WIDE_ONLY),
  control("SET-05", "delete-cancel", "default", "Cancel delete server", WIDE_ONLY),
  control("SET-07", "accounts-close", "default", "Close Codex accounts", WIDE_ONLY),
  control("SET-07", "accounts-refresh", "default", "Refresh Codex accounts", WIDE_ONLY),
  control("SET-07", "accounts-add", "default", "Add Codex account", WIDE_ONLY),

  selected("NAV-09", "server-selector-all", "All servers", PHONE_ONLY),
  selected("NAV-10", "server-selector-saved", "CodeWide E2E, Live", PHONE_ONLY),
  selected("RAIL-02", "rail-saved-server", "CodeWide E2E, Live", WIDE_ONLY),
  selectedMarker("ROW-07", "thread-row", "selected-thread-row", WIDE_ONLY),
  selected("FILTER-02", "thread-filter-running", "Thread filters"),
  selected("FILTER-03", "thread-filter-approval", "Thread filters"),
  selected("FILTER-04", "thread-filter-unread", "Thread filters"),
  selected("FILTER-05", "thread-filter-pinned", "Thread filters"),
  selected("FILTER-01", "thread-filter-all", "All threads"),
  selected("HEADER-06", "conversation-search-active", "Search in thread"),
  selectedMarker("ROW-07", "thread-row-open-selected", "selected-thread-row", WIDE_ONLY),

  disabled("INT-04", "composer-empty-send", "Send message"),
  disabled("INPUT-05", "composer-connecting", "Message Codex"),
  disabled("INPUT-07", "composer-send-pending", "Send message"),
  disabled("MENU-08", "composer-menu-terminal", "Terminal"),
  disabled("PAIR-01", "pairing-connect", "Connect server manually"),
  disabled("REQ-03", "user-question-submit", "Submit"),
  disabled("REQ-04", "elicitation-submit", "Submit"),
  disabled("ATT-04", "attachments-refresh", "Refresh session resources"),
  disabled("CHG-01", "changes-refresh", "Refresh changes"),
  disabled("PORT-01", "ports-refresh", "Refresh open ports"),
  disabled("PORT-05", "tunnel-open", "Open localhost tunnel"),
  disabled("PORT-06", "browser-close", "Close browser"),

  focused("LIST-08", "thread-search", "Search threads", PHONE_ONLY),
  focused("SEARCH-01", "conversation-search", "Search current thread"),
  focused("INPUT-02", "composer-one-line", "Message Codex"),
  focused("INPUT-03", "composer-multiline", "Message Codex"),
  focused("INPUT-04", "composer-keyboard", "Message Codex", PHONE_ONLY),
  focused("QUEUE-03", "queued-prompt-editor", "Queued prompt text"),
];

const OVERLAY_INVENTORY: readonly OverlayInventorySpec[] = [
  overlay("NAV-08", "server-selector", "sheet", "Choose server", "All servers", PHONE_ONLY),
  overlay("FILTER-01", "thread-filters", "popover", "Thread filters", "All threads"),
  overlay("LIST-06", "thread-list-menu", "popover", "Thread list menu", "Archived threads"),
  overlay(
    "HEADER-08",
    "context-account",
    "popover",
    "Context usage and account limits",
    "Context window",
  ),
  overlay("HEADER-10", "thread-menu", "popover", "Thread menu", "Pin thread"),
  overlay("MSG-12", "message-actions", "popover", "Message actions", "Copy"),
  overlay(
    "TURN-06",
    "turn-cost",
    "popover",
    "Estimated API-equivalent cost",
    "Usage breakdown",
  ),
  overlay("MENU-01", "composer-menu", "popover", "Composer menu", "Attach file"),
  overlay("QUEUE-02", "queued-prompts", "sheet", "Message Codex", "Queued prompts"),
  overlay("ATT-02", "empty-attachments", "sheet", "Message Codex", "No attachments"),
  overlay("ATT-03", "attachments", "sheet", "Message Codex", "Attachments", WIDE_ONLY),
  overlay("PORT-02", "ports", "sheet", "Message Codex", "No active ports", WIDE_ONLY),
  overlay("PORT-03", "discovered-ports", "sheet", "Message Codex", "Available"),
  overlay(
    "PORT-05",
    "bounded-tunnel-setup",
    "sheet",
    "Close ports",
    "Close localhost preview",
  ),
  overlay("SET-01", "settings", "sheet", "New thread", "Settings", WIDE_ONLY),
  overlay(
    "SET-05",
    "delete-server",
    "dialog",
    "Server settings",
    "Confirm delete server",
    WIDE_ONLY,
  ),
];

const PENDING_ALIAS_INVENTORY: readonly PendingAliasInventorySpec[] = [
  pendingAlias(
    "ATT-04",
    "attachments-refreshing",
    "attachment-resource-refresh",
    "Refresh session resources",
  ),
  pendingAlias("CHG-01", "changes-loading", "changes-refresh", "Refresh changes"),
  pendingAlias("PORT-01", "ports-loading", "ports-refresh", "Refresh open ports"),
  pendingAlias(
    "PORT-05",
    "bounded-tunnel-create-pending-policy",
    "bounded-tunnel-create",
    "Open localhost tunnel",
  ),
  pendingAlias(
    "PORT-06",
    "bounded-tunnel-revoke-pending-policy",
    "bounded-tunnel-revoke",
    "Close browser",
  ),
  pendingAlias("LIST-12", "search-voice-starting", "voice-start", "Stop voice input", false),
];

export const ASYNC_ACTION_INVENTORY: readonly AsyncActionInventorySpec[] = [
  { action: "pairing-connect", classification: "promise-pending", layouts: WIDE_ONLY },
  { action: "new-thread-create", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "saved-server-enable", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  {
    action: "saved-server-reconnect",
    classification: "lifecycle-pending",
    layouts: PHONE_AND_WIDE,
  },
  { action: "saved-server-save", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "existing-thread-send", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "stop-response", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  {
    action: "request-command-decline",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "request-queued-command-decline",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "request-user-input-submit",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "request-elicitation-submit",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "action-attachment-upload",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  { action: "attach-drawing", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  {
    action: "attachment-download",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "attachment-resource-refresh",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  { action: "attachment-retry", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "changes-refresh", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "change-retry", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "terminal-open", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  {
    action: "terminal-replay-retry",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  { action: "terminal-close", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "ports-refresh", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "port-forward", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  {
    action: "port-forward-remove",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "bounded-tunnel-create",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  {
    action: "bounded-tunnel-revoke",
    classification: "promise-pending",
    layouts: PHONE_AND_WIDE,
  },
  { action: "voice-start", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "voice-finish", classification: "promise-pending", layouts: PHONE_AND_WIDE },
  { action: "voice-retry", classification: "promise-pending", layouts: PHONE_AND_WIDE },
];

// These triggered controls deliberately have no INT-05 state: their activation completes at the
// local UI boundary and does not own the later transport/resource Promise.
export const SYNCHRONOUS_ACTION_INVENTORY: readonly SynchronousActionInventorySpec[] = [
  { action: "attachment-open", classification: "synchronous", reason: "navigation" },
  { action: "composer-port-forward-menu", classification: "synchronous", reason: "navigation" },
  { action: "composer-terminal-menu", classification: "synchronous", reason: "navigation" },
  { action: "composer-drawing-menu", classification: "synchronous", reason: "presentation" },
  { action: "bounded-preview-open", classification: "synchronous", reason: "navigation" },
  { action: "bounded-preview-close", classification: "synchronous", reason: "navigation" },
  { action: "ports-close", classification: "synchronous", reason: "navigation" },
  { action: "attachment-close", classification: "synchronous", reason: "navigation" },
  { action: "changes-scope-select", classification: "synchronous", reason: "local-selection" },
  { action: "request-option-select", classification: "synchronous", reason: "local-selection" },
  { action: "terminal-minimize", classification: "synchronous", reason: "presentation" },
  { action: "workspace-use-folder", classification: "synchronous", reason: "native-picker" },
  { action: "thread-open", classification: "synchronous", reason: "navigation" },
  { action: "archived-filter", classification: "synchronous", reason: "local-selection" },
  { action: "thread-filter", classification: "synchronous", reason: "local-selection" },
  { action: "queue-open", classification: "synchronous", reason: "presentation" },
  { action: "queue-close", classification: "synchronous", reason: "presentation" },
];

// These actions are pressed by their owning scenario after a local precondition changes the
// control identity. They therefore cannot be derived from the default/selected source captures.
const DEDICATED_PRESSED_ACTION_INVENTORY: readonly DedicatedPressedActionInventorySpec[] = [
  { layouts: PHONE_AND_WIDE, surface: "pairing-connect" },
  { layouts: PHONE_AND_WIDE, surface: "new-thread-send" },
  { layouts: PHONE_AND_WIDE, surface: "new-thread-send-failure" },
  { layouts: PHONE_AND_WIDE, surface: "saved-server-toggle" },
  { layouts: PHONE_AND_WIDE, surface: "existing-thread-send" },
  { layouts: PHONE_AND_WIDE, surface: "request-command-decline" },
  { layouts: PHONE_AND_WIDE, surface: "request-queued-command-decline" },
  { layouts: PHONE_AND_WIDE, surface: "request-user-input-submit" },
  { layouts: PHONE_AND_WIDE, surface: "request-elicitation-submit" },
  { layouts: PHONE_AND_WIDE, surface: "attachment-upload" },
  { layouts: PHONE_AND_WIDE, surface: "terminal-new-tab-action" },
];

export const INTERACTION_INVENTORY_STATE_NAMES: readonly string[] = [
  ...CONTROL_INVENTORY.flatMap((spec) =>
    spec.layouts.map(
      (layout) => `${rowIdForKind(spec.kind)}:${layout}-${spec.surface}-${spec.kind}`,
    ),
  ),
  ...OVERLAY_INVENTORY.flatMap((spec) =>
    spec.layouts.flatMap((layout) => [
      `INT-07:${layout}-${spec.surface}-scrim`,
      `INT-08:${layout}-${spec.surface}-safe-area`,
    ]),
  ),
  ...CONTROL_INVENTORY.filter((spec) => isPressableKind(spec.kind)).flatMap((spec) =>
    spec.layouts.map((layout) => `INT-02:${pressedState(spec, layout)}`),
  ),
  ...DEDICATED_PRESSED_ACTION_INVENTORY.flatMap((spec) =>
    spec.layouts.map((layout) => `INT-02:${layout}-${spec.surface}-pressed`),
  ),
  ...ASYNC_ACTION_INVENTORY.flatMap((spec) =>
    spec.layouts.map((layout) => `INT-05:${layout}-${spec.action}-pending`),
  ),
];

assertUniqueInventoryStateNames(INTERACTION_INVENTORY_STATE_NAMES);

/**
 * Classifies one already-real parity capture into dedicated atomic interaction evidence.
 * The source row's exact assertion runs first; these checks then prove the interaction semantics.
 */
export async function collectInteractionInventoryAliases(
  input: InteractionInventorySource,
): Promise<readonly InteractionInventoryAlias[]> {
  const layout = readLayout(input.sourceState);
  if (layout === null) return [];
  const aliases: InteractionInventoryAlias[] = [];
  for (const spec of CONTROL_INVENTORY) {
    if (spec.sourceRowId !== input.sourceRowId || !spec.layouts.includes(layout)) continue;
    const rowId = rowIdForKind(spec.kind);
    const state = `${layout}-${spec.surface}-${spec.kind}`;
    if (input.sourceRowId === rowId && input.sourceState === state) continue;
    assertNodeExpectation(input.pageSource, spec.expectation, spec.surface);
    aliases.push({
      assertExactState: async () => {
        assertNodeExpectation(await input.driver.getPageSource(), spec.expectation, spec.surface);
      },
      rowId,
      state,
    });
  }
  for (const spec of OVERLAY_INVENTORY) {
    if (spec.sourceRowId !== input.sourceRowId || !spec.layouts.includes(layout)) continue;
    assertOverlaySource(input.pageSource, spec);
    aliases.push({
      assertExactState: async () => {
        assertOverlaySource(await input.driver.getPageSource(), spec);
      },
      rowId: "INT-07",
      state: `${layout}-${spec.surface}-scrim`,
    });
    await assertOverlaySafeArea(input.driver, input.pageSource, spec);
    aliases.push({
      assertExactState: async () => {
        const freshSource = await input.driver.getPageSource();
        assertOverlaySource(freshSource, spec);
        await assertOverlaySafeArea(input.driver, freshSource, spec);
      },
      rowId: "INT-08",
      state: `${layout}-${spec.surface}-safe-area`,
    });
  }
  for (const spec of PENDING_ALIAS_INVENTORY) {
    if (
      spec.sourceRowId !== input.sourceRowId ||
      input.sourceState !== `${layout}-${spec.sourceStateSuffix}` ||
      !spec.layouts.includes(layout)
    ) {
      continue;
    }
    assertNodeExpectation(input.pageSource, spec.expectation, spec.action);
    aliases.push({
      assertExactState: async () => {
        assertNodeExpectation(await input.driver.getPageSource(), spec.expectation, spec.action);
      },
      rowId: "INT-05",
      state: `${layout}-${spec.action}-pending`,
    });
  }
  return aliases;
}

/** Captures each real enabled control with the W3C touch pointer held down. */
export async function capturePressedInteractionInventory(
  input: PressedInteractionInventorySource,
): Promise<void> {
  const layout = readLayout(input.sourceState);
  if (layout === null) return;
  for (const spec of CONTROL_INVENTORY) {
    if (
      spec.sourceRowId !== input.sourceRowId ||
      !spec.layouts.includes(layout) ||
      !isPressableKind(spec.kind)
    ) {
      continue;
    }
    const sourceNode = findExpectedNode(input.pageSource, spec.expectation, spec.surface);
    const bounds = readBounds(sourceNode, spec.surface);
    const pointerId = `inventory-${spec.surface}`;
    await input.driver.performActions([
      {
        actions: [
          {
            duration: 0,
            type: "pointerMove",
            x: bounds.left + Math.floor((bounds.right - bounds.left) / 2),
            y: bounds.top + Math.floor((bounds.bottom - bounds.top) / 2),
          },
          { button: 0, type: "pointerDown" },
          { duration: 40, type: "pause" },
        ],
        id: pointerId,
        parameters: { pointerType: "touch" },
        type: "pointer",
      },
    ]);
    try {
      await input.capture("INT-02", pressedState(spec, layout), async () => {
        const pressedSource = await input.driver.getPageSource();
        assertNodeExpectation(pressedSource, spec.expectation, spec.surface);
      });
    } finally {
      // Move outside the original hit target before lifting so collecting one pressed-state
      // artifact cannot activate the control and invalidate the remaining inventory on screen.
      await input.driver
        .performActions([
          {
            actions: [
              { duration: 0, type: "pointerMove", x: 0, y: 0 },
              { button: 0, type: "pointerUp" },
            ],
            id: pointerId,
            parameters: { pointerType: "touch" },
            type: "pointer",
          },
        ])
        .catch(() => undefined);
      await input.driver.releaseActions();
    }
  }
}

/** Fails closed when an inventory state that should have been exercised has no paired INT capture. */
export function assertInteractionInventoryCoverage(
  captures: readonly InteractionInventoryCapture[],
): void {
  const captured = new Set(captures.map((capture) => `${capture.rowId}:${capture.state}`));
  const missing = INTERACTION_INVENTORY_STATE_NAMES.filter((entry) => !captured.has(entry));
  if (missing.length > 0) {
    throw new Error(`Interaction parity inventory is incomplete: ${missing.join(", ")}`);
  }
}

function assertUniqueInventoryStateNames(states: readonly string[]): void {
  const seen = new Set<string>();
  for (const state of states) {
    if (seen.has(state)) {
      throw new Error(`Interaction parity inventory contains duplicate state ${state}`);
    }
    seen.add(state);
  }
}

function control(
  sourceRowId: string,
  surface: string,
  kind: "default",
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { attribute: "enabled", token, value: "true" },
    kind,
    layouts,
    sourceRowId,
    surface,
  };
}

function prefixControl(
  sourceRowId: string,
  surface: string,
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { attribute: "enabled", match: "prefix", token, value: "true" },
    kind: "default",
    layouts,
    sourceRowId,
    surface,
  };
}

function selected(
  sourceRowId: string,
  surface: string,
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { attribute: "selected", token, value: "true" },
    kind: "selected",
    layouts,
    sourceRowId,
    surface,
  };
}

function selectedMarker(
  sourceRowId: string,
  surface: string,
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { match: "markup", token },
    kind: "selected",
    layouts,
    sourceRowId,
    surface,
  };
}

function disabled(
  sourceRowId: string,
  surface: string,
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { attribute: "enabled", token, value: "false" },
    kind: "disabled",
    layouts,
    sourceRowId,
    surface,
  };
}

function focused(
  sourceRowId: string,
  surface: string,
  token: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): ControlInventorySpec {
  return {
    expectation: { attribute: "focused", token, value: "true" },
    kind: "focused",
    layouts,
    sourceRowId,
    surface,
  };
}

function overlay(
  sourceRowId: string,
  surface: string,
  kind: OverlayKind,
  backgroundToken: string,
  foregroundToken: string,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): OverlayInventorySpec {
  return { backgroundToken, foregroundToken, kind, layouts, sourceRowId, surface };
}

function pendingAlias(
  sourceRowId: string,
  sourceStateSuffix: string,
  action: string,
  token: string,
  disabled = true,
  layouts: readonly InteractionLayout[] = PHONE_AND_WIDE,
): PendingAliasInventorySpec {
  return {
    action,
    expectation: disabled ? { attribute: "enabled", token, value: "false" } : { token },
    layouts,
    sourceRowId,
    sourceStateSuffix,
  };
}

function rowIdForKind(kind: InteractionKind): InteractionInventoryRowId {
  if (kind === "default") return "INT-01";
  if (kind === "selected") return "INT-03";
  if (kind === "disabled") return "INT-04";
  return "INT-06";
}

function isPressableKind(kind: InteractionKind): boolean {
  return kind === "default" || kind === "selected";
}

function pressedState(spec: ControlInventorySpec, layout: InteractionLayout): string {
  const selected = spec.kind === "selected" ? "-selected" : "";
  return `${layout}-${spec.surface}${selected}-pressed`;
}

function readLayout(state: string): InteractionLayout | null {
  if (state.startsWith("phone-")) return "phone";
  if (state.startsWith("wide-")) return "wide";
  return null;
}

function assertNodeExpectation(
  source: string,
  expectation: NodeExpectation,
  surface: string,
): void {
  findExpectedNode(source, expectation, surface);
}

function findExpectedNode(source: string, expectation: NodeExpectation, surface: string): string {
  const node = xmlElements(source).find((candidate) => matchesNodeToken(candidate, expectation));
  if (node === undefined) {
    throw new Error(
      `Interaction inventory ${surface} cannot find its exact semantic token ${expectation.token}`,
    );
  }
  if (
    expectation.attribute !== undefined &&
    expectation.value !== undefined &&
    !node.includes(`${expectation.attribute}="${expectation.value}"`)
  ) {
    throw new Error(
      `Interaction inventory ${surface} expected ${expectation.attribute}=${expectation.value}`,
    );
  }
  return node;
}

function matchesNodeToken(candidate: string, expectation: NodeExpectation): boolean {
  const escaped = xmlEscape(expectation.token);
  if (expectation.match === "markup") return candidate.includes(escaped);
  const prefixes = [`text="${escaped}`, `content-desc="${escaped}`, `resource-id="${escaped}`];
  if (expectation.match === "prefix") {
    return prefixes.some((prefix) => candidate.includes(prefix));
  }
  return prefixes.some((prefix) => candidate.includes(`${prefix}"`));
}

function assertOverlaySource(source: string, spec: OverlayInventorySpec): void {
  if (!xmlElements(source).some((node) => matchesNodeToken(node, { token: spec.foregroundToken }))) {
    throw new Error(`Interaction inventory ${spec.surface} lost overlay content`);
  }
  if (!xmlElements(source).some((node) => matchesNodeToken(node, { token: spec.backgroundToken }))) {
    throw new Error(
      `Interaction inventory ${spec.surface} unmounted the surface behind its overlay`,
    );
  }
  if (spec.kind === "sheet" && !source.includes('pane-title="Bottom Sheet"')) {
    throw new Error(`Interaction inventory ${spec.surface} is not exposed as a bottom sheet`);
  }
}

async function assertOverlaySafeArea(
  driver: AppiumBrowser,
  source: string,
  spec: OverlayInventorySpec,
): Promise<void> {
  const viewport = await driver.getWindowSize();
  const elements = parseXmlElements(source);
  const containerNode =
    spec.kind === "sheet"
      ? elements.find(
          (candidate) =>
            candidate.openTag.includes('pane-title="Bottom Sheet"') &&
            !subtreeContainsToken(candidate, spec.backgroundToken),
        )
      : findBoundedOverlayContainer(
          elements,
          spec.backgroundToken,
          spec.foregroundToken,
          viewport.width,
          viewport.height,
        );
  if (containerNode === undefined) {
    throw new Error(`Interaction inventory ${spec.surface} has no measurable overlay container`);
  }
  const { bottom, left, right, top } = readBounds(containerNode.openTag, spec.surface);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    left < 0 ||
    top < 0 ||
    right > viewport.width ||
    bottom > viewport.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error(
      `Interaction inventory ${spec.surface} exceeds the viewport: ${left},${top}-${right},${bottom} in ${viewport.width}x${viewport.height}`,
    );
  }
}

function readBounds(node: string, surface: string): AndroidBounds {
  const match = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
  if (match === null) {
    throw new Error(`Interaction inventory ${surface} has no Android bounds`);
  }
  return {
    bottom: Number(match[4]),
    left: Number(match[1]),
    right: Number(match[3]),
    top: Number(match[2]),
  };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function xmlElements(source: string): string[] {
  return [...source.matchAll(/<[^/!?][^>]*>/gu)].map((match) => match[0]);
}

function findBoundedOverlayContainer(
  elements: readonly XmlElementNode[],
  backgroundToken: string,
  foregroundToken: string,
  viewportWidth: number,
  viewportHeight: number,
): XmlElementNode | undefined {
  const foreground = elements.find((candidate) =>
    matchesNodeToken(candidate.openTag, { token: foregroundToken }),
  );
  if (foreground === undefined) return undefined;
  const foregroundBounds = tryReadBounds(foreground.openTag);
  if (foregroundBounds === null) return undefined;
  let candidate: XmlElementNode | null = foreground.parent;
  let boundedContainer: XmlElementNode | undefined;
  while (candidate !== null) {
    const bounds = tryReadBounds(candidate.openTag);
    if (
      bounds !== null &&
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= viewportWidth &&
      bounds.bottom <= viewportHeight &&
      !subtreeContainsToken(candidate, backgroundToken) &&
      bounds.left <= foregroundBounds.left &&
      bounds.top <= foregroundBounds.top &&
      bounds.right >= foregroundBounds.right &&
      bounds.bottom >= foregroundBounds.bottom &&
      (bounds.left < foregroundBounds.left ||
        bounds.top < foregroundBounds.top ||
        bounds.right > foregroundBounds.right ||
        bounds.bottom > foregroundBounds.bottom) &&
      (bounds.left > 0 ||
        bounds.top > 0 ||
        bounds.right < viewportWidth ||
        bounds.bottom < viewportHeight)
    ) {
      boundedContainer = candidate;
    }
    candidate = candidate.parent;
  }
  return boundedContainer;
}

function subtreeContainsToken(node: XmlElementNode, token: string): boolean {
  const pending = [node];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (candidate === undefined) break;
    if (matchesNodeToken(candidate.openTag, { token })) return true;
    pending.push(...candidate.children);
  }
  return false;
}

function parseXmlElements(source: string): XmlElementNode[] {
  const elements: XmlElementNode[] = [];
  const stack: XmlElementNode[] = [];
  for (const match of source.matchAll(/<([^!?][^>]*)>/gu)) {
    const body = match[1];
    if (body === undefined) continue;
    if (body.startsWith("/")) {
      stack.pop();
      continue;
    }
    const parent = stack.at(-1) ?? null;
    const node: XmlElementNode = { children: [], openTag: `<${body}>`, parent };
    parent?.children.push(node);
    elements.push(node);
    if (!body.endsWith("/")) stack.push(node);
  }
  return elements;
}

function tryReadBounds(node: string): AndroidBounds | null {
  const match = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
  if (match === null) return null;
  return {
    bottom: Number(match[4]),
    left: Number(match[1]),
    right: Number(match[3]),
    top: Number(match[2]),
  };
}
