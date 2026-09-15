# V1 changes

Public surfaces: ChangesFeature.useChangesFeature, changePresentation, ThreadResourceContextChips and turnChanges. These owners select session/turn resources, retain per-qualified-thread display preferences, present recorded patches and open source references through the existing review workspace. Private capability declarations remain local.

The lower ThreadResourcesModel and diff loader remain authoritative. Recorded turn presentation derives from the received file changes without reading the current worktree; duplicate paths aggregate counters while preserving patch order. The existing preferences Map retains its module lifetime. Fullscreen presentation uses the host's scope/lifecycle binding, and review attachment submission is an injected capability. Shared chip labels/counts live at ui/ResourceContextChip.

M4 changes subunit: V1 typing/lint/dependency gate passed (2176 modules, 7614 dependencies); 65 focused semantic/source/boundary tests and three render cases passed. Native review/changes interaction and same-device performance remain unverified. The separately gated review workspace extraction is complete.
