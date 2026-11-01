# V1 agents

## Ownership and composition

Public surfaces: the nested `/threads/.../agents` route presents the fullscreen workspace; `SubagentSheet` owns the original V1 responsive child selection, captured root label, narrow back/focus restoration and detail presentation; `agentSelection` owns the scoped projection and qualified catalog read; `ComposerSubagentContextChip` reads that catalog. `workingSubagents` reads the same catalog without suspending and picks children whose own thread is active; `WorkingSubagentsMenu` floats them beside the live plan while any works. Neither infers status from parent items.

`lineageProjection` is the pure read-model owner for actual-parent lineage. It derives a root/parent label path and depth only from the durable child-link `parentThreadId` chain and captured real thread labels. `SubagentWorkspace` owns master/detail and quiet section composition; it inserts a 32dp section label only when that real lineage path changes and never reorders the existing child rows. `SubagentRow` remains the 64dp semantic/open-child control and owns the accessible child-plus-lineage description. `SubagentConversation` passes the captured parent breadcrumb through the narrow public capability of `ConversationReadSurface`; the conversation header renders one muted subtitle line and does not import the agents feature.

Private workspace rows, pending/detail presentation and styles stay local. Existing typography, `WaveText`, list geometry, menu/chip primitives, unread/time/error placement and the read-only child conversation stay with their current owners. The existing 56dp headers, 64dp rows, 32dp section labels, 48dp targets, 16dp selection radius and master/detail breakpoint are preserved. No dashboard, task board, progress bar, lifecycle pill, cost/provider/attempt badge or Retry/Resume/Cancel control belongs in this UI slice.

## Data and navigation invariants

The existing ThreadSummaryDatabase, ThreadDetailDatabase and thread-chat-window resource remain authoritative. Android reads the compatible child projection only; it must not read orchestration task, attempt, event, permission, workspace or delivery records, and it must not derive child UI status from task outcome. Explicit opening captures the already visible summaries and real thread labels, starts catalog refresh and retains that local snapshot on rejection. The opaque route session replaces only the former overlay handle.

Child selection stays local in its existing Transition, and the fullscreen route preserves the owning conversation below it. Child callbacks carry the owning connection identity, and the outer composition binds the read-only detail renderer. Row press still opens the same child thread; lineage and breadcrumb context never change thread identity. Narrow back returns to the selected row and prior scroll anchor; desktop no-selection remains unchanged.

Legacy or incomplete lineage fails honestly: a missing parent, cycle or old child link yields an ordinary ungrouped, still-openable row in its original recency order. A section or breadcrumb segment must resolve to an actual parent thread label. There is no phase field, phase inference, guessed parent or synthetic segment in V1; a label such as `Release planning › Review` is valid only when both are real threads in the ancestry.

Render data stays in the existing Legend-owned resources; do not add effect-triggered reads, parallel loading state or a duplicated child catalog. Escaping handlers use `useEvent`; render-local callbacks remain ordinary functions. Do not add `useCallback`, `useMemo`, `Object.freeze`, `structuredClone` or defensive collection clones.

M4 agents: V1 gate passed (2240 modules, 7931 dependencies); 67 focused tests and one workspace render case passed. The lineage/breadcrumb slice requires focused read-model/render checks plus `pnpm validate:android:v1` and `pnpm --filter @codewide/android compile:android`. Actual device responsive navigation, child scrolling, focus restoration and Android back remain device evidence, not source-test proof.
