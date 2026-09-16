# V1 agents

Public surfaces: the nested `/v1/threads/.../agents` routes retain master/detail history; `RouteSubagentWorkspace` owns responsive child selection and detail presentation; `agentSelection` owns the scoped projection and qualified catalog read; `ComposerSubagentContextChip` reads that catalog; `subagentConversationContract` exposes the narrow child-read render capability. Private workspace rows, pending/detail presentation and styles stay local.

The existing ThreadSummaryDatabase, ThreadDetailDatabase and thread-chat-window resource remain authoritative. Explicit opening starts catalog refresh and retains local summaries on rejection. Child selection stays in its existing Transition; the mounted sheet survives opening conversation unmount. Child callbacks carry the owning connection identity, and the outer composition binds the read-only detail renderer. M6 closed the legacy root renderer through the public conversation read capabilities.

M4 agents: V1 gate passed (2240 modules, 7931 dependencies); 67 focused tests and one workspace render case passed. Actual device responsive navigation and child scrolling remain unverified.
