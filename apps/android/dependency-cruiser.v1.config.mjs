import v2 from "./dependency-cruiser.v2.config.mjs";

const legacySource = "^(?:app/(?:legacy[.]tsx$|v1/)|src/(?!(?:v2|boot|presentation)/))";

// Exact public modules of completed feature units; private views, styles and session helpers stay local.
const featurePublicModules = {
  workspace: [
    "useWindowLayout",
    "WorkspaceConversationProviders",
    "WorkspaceThreadList",
    "workspaceListBindings",
    "workspaceProjectBindings",
    "useV1WorkspaceDeepLinks",
  ],
  conversation: [
    "ConversationWorkspace",
    "ConversationDetail",
    "ConversationReadSurface",
    "conversationRouteNavigation",
  ],
  diagnostics: [
    "PerformanceDiagnostics",
    "renderRecovery",
    "conversationDiagnosticCapabilities",
    "ThreadNavigationCommit",
  ],
  connections: [
    "connectionProjection",
    "ConnectionSheet",
    "ConnectionFeature",
    "connectionActions",
    "connectionPresentation",
    "connectionSettingsContract",
  ],
  accounts: [
    "AccountPoolFeature",
    "WorkspaceAccountUsagePopover",
    "UsagePopover",
    "accountCapabilities",
    "threadListAccountRefresh",
    "CostBreakdownPopover",
    "conversationAccountCapabilities",
  ],
  settings: ["SettingsFeature"],
  composer: [
    "ComposerFeature",
    "composerState",
    "composerCommands",
    "composerInteractions",
    "ComposerMenu",
    "input/ComposerEditorTrialEntry",
    "ReadOnlyComposerContext",
    "composerTypes",
    "composerWorkspaceCapabilities",
  ],
  projects: [
    "newChatSubmission",
    "ProjectPickerSheet",
    "projectPickerContract",
    "projectSelection",
    "projectWorkspace",
    "activeProjectSelection",
    "composerProjectSelection",
    "NewThreadServerSheet",
    "NewThreadFloatingButton",
    "SidebarProjects",
    "sidebarProjects",
    "projectConversationCapabilities",
  ],
  threadList: [
    "SidebarListFeedback",
    "ThreadListFeature",
    "threadListTypes",
    "threadListSources",
    "threadListState",
    "threadListWorkspace",
    "threadListActions",
    "projectThreadList",
    "threadListFilters",
    "threadListModel",
    "threadListProjection",
    "ThreadSidebarContract",
    "MobileThreadsContract",
  ],
  agents: [
    "agentSelection",
    "ComposerSubagentContextChip",
    "RouteSubagentWorkspace",
    "conversationAgentCapabilities",
    "subagentConversationContract",
  ],
  terminal: [
    "terminalActions",
    "backgroundTerminals",
    "ComposerTerminalContextChip",
    "conversationTerminalCapabilities",
  ],
  ports: [
    "PortsFeature",
    "ComposerPortContextChip",
    "ForwardedLoopbackBrowser",
    "browserNavigation",
    "nativeForwardingAdapter",
    "portForwardingContract",
    "browser/feedbackSubmission",
    "browser/feedback",
    "browser/BrowserFeedbackContext",
    "conversationPortCapabilities",
  ],
  drawing: ["DrawingFeature", "drawingAttachment"],
  review: [
    "ReviewFeature",
    "CodeReviewWorkspace",
    "ReviewTargetSheet",
    "code-review-files",
    "reviewSubmission",
    "conversationReviewCapabilities",
  ],
  changes: [
    "ChangesFeature",
    "changePresentation",
    "ThreadResourceContextChips",
    "turnChanges",
    "conversationChangeCapabilities",
  ],
  attachments: [
    "AttachmentsFeature",
    "documentNavigation",
    "attachmentVisibility",
    "conversationAttachmentCapabilities",
  ],
  requests: [
    "pendingRequests",
    "RequestFeature",
    "requestResponse",
    "ConversationRequestPrompts",
    "conversationRequestCapabilities",
  ],
  goal: [
    "GoalFeature",
    "ThreadGoalChip",
    "LiveTurnPlanPopover",
    "goalResource",
    "goalCommands",
    "conversationGoalCapabilities",
  ],
  queue: [
    "QueueFeature",
    "InlineQueueOverlay",
    "inlineQueueContract",
    "queueVisibility",
    "queueCommands",
    "queueWorkspaceCapabilities",
  ],
  turnActions: [
    "ThreadActions",
    "ThreadRenameDialog",
    "threadRename",
    "turnActions",
    "turnActionCapabilities",
    "threadConversationCapabilities",
  ],
  search: [
    "GlobalSearchScreen",
    "search-conversation-window",
    "search-session",
    "threadSearch",
    "searchCapabilities",
    "use-search-conversation-window",
  ],
};

/** V1 keeps its own architecture rules while sharing the Metro resolver with V2. */
export default {
  forbidden: [
    {
      name: "v1-router-imports-stay-in-routes",
      severity: "error",
      comment:
        "Expo Router owns V1 destinations; features, components, services, data, and native code receive narrow route intents.",
      from: { path: "^src/(?:features|components|services|data|native)/" },
      to: { path: "^expo-router$" },
    },
    {
      name: "v1-source-does-not-import-routes",
      severity: "error",
      comment:
        "V1 route organisms compose source owners; source owners cannot depend back on app routes.",
      from: { path: "^src/(?:features|components|services|data|native)/" },
      to: { path: "^app/v1/" },
    },
    {
      name: "v1-conversation-read-owners-do-not-import-feature-composition",
      severity: "error",
      comment:
        "Conversation read owners consume the agent read contract, never the active route composition.",
      from: {
        path: "^src/features/conversation/(?:ConversationDetail[.]|ConversationReadSurface[.]|SubagentConversation[.]|timeline/|turns/|protocol/|content/)",
      },
      to: { path: "^src/features/agents/(?:AgentsFeature|RouteSubagentWorkspace)[.]" },
    },
    {
      name: "v1-conversation-core-read-owners-do-not-import-feature-composition",
      severity: "error",
      comment:
        "Detail, readonly and transcript owners consume read/navigation capabilities; composer and tool assembly stays above them.",
      from: {
        path: "^src/features/conversation/(?:ConversationDetail[.]|ConversationReadSurface[.]|timeline/|turns/|protocol/|content/)",
      },
      to: {
        path: "^src/features/(?:composer/|goal/ThreadGoalChip[.]|requests/RequestFeature[.]|changes/ChangesFeature[.]|terminal/TerminalFeature[.]|conversation/(?:ConversationComposition|ConversationWorkspace|ConversationTools|conversationCompositionCapabilities)[.]|workspace/(?!useWindowLayout[.]))",
      },
    },
    ...Object.entries(featurePublicModules).map(([feature, modules]) => ({
      name: `v1-${feature}-private-modules-stay-local`,
      severity: "error",
      comment:
        "Other features consume only this owner's declared public capabilities and presentation contracts.",
      from: { path: `^src/features/(?!${feature}/)` },
      to: {
        path: `^src/features/${feature}/`,
        pathNot: `^src/features/${feature}/(?:${[...modules, "workspaceCapabilities", "workspaceAdapter"].join("|")})(?:[.](?:native|web))?[.]tsx?$`,
      },
    })),
    ...Object.keys(featurePublicModules).map((feature) => ({
      name: `v1-${feature}-adapter-is-composition-only`,
      severity: "error",
      comment: "Only the owning feature and exact workspace factory bind concrete adapters.",
      from: {
        path: `^src/features/(?!${feature}/)`,
        pathNot: "^src/features/workspace/createWorkspaceFeatures[.]ts$",
      },
      to: { path: `^src/features/${feature}/workspaceAdapter[.]ts$` },
    })),
    {
      name: "v1-migrated-features-do-not-import-workspace-facade",
      severity: "error",
      from: { path: `^src/features/(?:${Object.keys(featurePublicModules).join("|")})/` },
      to: { path: "^src/data/use-remote-workspace[.]" },
    },
    {
      name: "v1-lower-owners-do-not-import-features",
      severity: "error",
      comment:
        "Data and native authorities cannot acquire feature policy or root composition, including through type imports.",
      from: { path: "^src/(?:data|native)/" },
      to: { path: "^src/features/|^src/CodeWideScreen[.]tsx$" },
    },
    {
      name: "v1-features-do-not-import-root-composition",
      severity: "error",
      comment: "The route composes feature capabilities; features cannot depend back on it.",
      from: { path: "^src/features/" },
      to: { path: "^src/CodeWideScreen[.]tsx$" },
    },
    {
      name: "v1-no-circular-dependencies",
      severity: "error",
      comment: "V1 dependencies, including type contracts, must remain acyclic.",
      from: { path: legacySource },
      to: { circular: true },
    },
    {
      name: "v1-no-unresolved-dependencies",
      severity: "error",
      from: { path: legacySource },
      to: { couldNotResolve: true },
    },
    {
      name: "v1-does-not-import-v2",
      severity: "error",
      comment:
        "The generation bridge owns composition; V1 cannot import the V2 runtime or protocol.",
      from: { path: legacySource },
      to: { path: "^src/v2/|^@codewide/sync-client/v2$|(?:^|/)packages/sync-client/src/v2/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      ...v2.options.enhancedResolveOptions,
      // Type-only packages expose declarations instead of a JavaScript main file.
      extensions: [...v2.options.enhancedResolveOptions.extensions, ".d.ts"],
      mainFields: [...v2.options.enhancedResolveOptions.mainFields, "types", "typings"],
    },
    doNotFollow: v2.options.doNotFollow,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
