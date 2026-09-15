# V1 navigation

This TypeScript owner publishes the existing discriminated destination and generation. `threadNavigation.ts` remains runtime-neutral; React/native interaction lives in `navigationActions.ts`, `conversationNavigationActions.ts`, `serverSelection.ts` and `workspaceDeepLinks.ts`. `ConversationHost.tsx` retains its separate selected-destination subscription. These modules, `conversationScope.ts` and `threadSelection.ts` are public navigation contracts; other features do not import private implementation.

Main-chat selection starts the existing observer, ends the previous IME session, begins cached presentation and publishes selection immediately. It never awaits complete history. Preloading uses the same detail database and saved anchor, returns the original release capability, and never creates a second cache. Repeated selection remains an explicit reload. Search selection owns the existing SearchConversationWindow; subagent Transition behavior is unchanged.

The mounted workspace owns the model. Deep-link listeners retain the lower subscription's cleanup. Native resource stop and feature unmount do not dispose module-started JS stores. Navigation consumes only existing read handles and explicit selection/pairing callbacks. Thread identity and connection display are public peer contracts; no facade, private peer or V2 imports are permitted.

M2 automated evidence: navigation model and transition contracts, V1 project/navigation render tests, V1 dependency gates and native/web/compatibility typing. Real device keyboard, deep-link and back-navigation smoke remains pending under the approved device disclosure.
