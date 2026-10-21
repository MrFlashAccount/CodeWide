# V1 pull requests catalog

Public surfaces: `PullRequestsFeature` (`PullRequestsCatalog`, the `/pulls` content for one connection), `CatalogModeBar` (the always-mounted Threads | Pull requests bar of the catalog pane), `PullRequestsHeader` and `pullRequestListModel` (category/repository filter and the Accounts sheet switch). `workspaceCapabilities.ts` declares the connect and account mutations; the private `workspaceAdapter.ts` binds them through `createWorkspaceFeatures` only.

The feature owns presentation and interaction policy of the catalog: onboarding cards per provider (known `iconKey`s get native explanations, every other provider its plugin label and detail), connect methods (`linkExisting`, `hostLogin` with the one-time code and one open-link button, `pasteToken`, `instructions` with Check again), the optional checks credential, account states (`connected`, `expired`, `error`), disconnect modes (`unlink` by default, `forgetToken` for saved tokens, `logoutHost` only behind a destructive dialog), the PR list with account sections, problem rows, category chips and the repository filter, and the offline snapshot notice.

Data and Promise identity stay in `data/forgeResources.ts`; this feature reads its Legend snapshots during render and never mirrors them. Pending connect state lives in `onboarding/onboardingModel.ts`; a live host-login flow is companion-owned and re-read from the accounts resource, so it survives app restarts.

Tokens: a pasted token lives only in `TokenPasteSheet` component state, is cleared on submit, dismiss and error, and is sent once by `submitToken` directly on the session (no outbox, no request telemetry). Provider-supplied URLs open only when `https` on the provider host (`onboarding/providerUrl.ts`).

Boundaries: this feature must not import `features/pullRequestDetail` (and the reverse); they meet only through `routeComposition` navigation intents. `features/threadList` must not import this feature. Behavior branches on capabilities and descriptor kinds, never on plugin ids or forge names.
