# V1 search

This TypeScript/TSX owner retains the existing SearchSession, query/filter/calendar state, indexed result screens and SearchConversationWindow. searchWorkspace owns workspace focus/visibility; threadSearch owns the existing debounced mobile catalog-search resource and publishes list results/status. It does not create a second search store or mirror render resources into component state.

Public modules are GlobalSearchScreen, search-conversation-window, search-session, searchWorkspace, threadSearch, searchCapabilities and use-search-conversation-window. The unmounted legacy SearchContextScreen and its unused standalone context RPC capability were removed during final closure; the mounted destination continues to use SearchConversationWindow. The destination read boundary uses the last hook solely to cancel viewport continuation on selection release. Search filters, calendar and delay implementation stay private. Navigation receives the existing located-hit/window contract. The list supplies its public summary conversion and item type; project and server scope use public peer contracts. SearchMessageFocus is a shared rendering primitive at rendering/SearchMessageFocus.tsx, so generic renderers never depend on this feature.

Search methods preserve the validated lower message/context query contracts. The same resource keys, debounce cancellation, session focus intent and progressive search-window Promise identity remain in use. Explicit close changes visibility; it does not invent runtime disposal or purge retained caches.

M2 evidence includes search window/calendar semantic tests and global-search/filter/density render tests, plus native/web/compatibility typing, dependency boundaries and platform bundling. Device keyboard/search navigation smoke is pending; no performance improvement is claimed.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

`GlobalSearchView`, `SearchResultRows` and `FilterSelect` are private display owners. SearchSession and GlobalSearchScreen retain search state, stable resource reads and navigation. `LocatedSearchHit` remains declared at the existing GlobalSearchScreen public entrypoint. Private `searchResultTypes` supplies the single shared target shape and server result union to search views; peers cannot import it.
