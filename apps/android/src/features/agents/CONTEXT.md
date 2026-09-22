# V1 agents

Public surfaces: the nested `/threads/.../agents` route presents the fullscreen workspace; `SubagentSheet` owns the original V1 responsive child selection and detail presentation; `agentSelection` owns the scoped projection and qualified catalog read; `ComposerSubagentContextChip` reads that catalog. Private workspace rows, pending/detail presentation and styles stay local.

The existing ThreadSummaryDatabase, ThreadDetailDatabase and thread-chat-window resource remain authoritative. Explicit opening captures the already visible summaries, starts catalog refresh and retains that local snapshot on rejection. The opaque route session replaces only the former overlay handle. Child selection stays local in its existing Transition, and the fullscreen route preserves the owning conversation below it. Child callbacks carry the owning connection identity, and the outer composition binds the read-only detail renderer. M6 closed the legacy root renderer through the public conversation read capabilities.

M4 agents: V1 gate passed (2240 modules, 7931 dependencies); 67 focused tests and one workspace render case passed. Actual device responsive navigation and child scrolling remain unverified.
