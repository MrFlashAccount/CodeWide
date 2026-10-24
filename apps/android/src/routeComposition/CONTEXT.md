# Application route composition

This owner binds Expo Router navigation to the existing workspace, feature and resource owners.
`app/(workspace)/**` contains only destination screens and layouts; reusable route composition,
responsive shell, URL selection policy and tool-route bindings live here so Expo does not publish
helper modules as destinations. The workspace group contributes no URL segment.

Routes may import these modules. Features, components, services, data and native owners must not
import route composition or route modules; they consume narrow navigation intents instead.
Route composition may use Expo Router and existing feature capabilities, but does not own
transport, persistence, protocol reduction or application data loading.

The root providers and workspace native runtime lifetime remain in their existing layouts.
Moving composition must preserve immediate main-thread publication, progressive hydration,
composer restoration, desktop sidebar identity, search history and route-session retention.
`WorkspacePaneLayout` owns the single `WorkspaceTwoPaneLayout` instance shared by the retained
Threads catalog/detail pair and the Pull requests catalog/preview pair. Route components provide
slot content and must not nest another split layout. The discriminated presentation mode owns only
pane placement and width; route focus, accessibility, lifetimes, surfaces and data remain with the
outer owner and its callers.

On wide Pull request destinations, route composition may add the PR-linked thread as a right sidebar.
It must mount the ordinary `ActiveWorkspaceConversation` with the same thread identity and workspace
providers as the Chats route. The PR feature owns only the open/create intent; route composition owns
sidebar placement, expansion, fullscreen and closing. On a foldable, opening chat immediately claims
the catalog width and animates the PR surface left while the canonical chat enters from the right;
compact navigation shows a local chat skeleton while the canonical thread id resolves. Never
introduce a PR-specific conversation renderer or composer.

Run `pnpm validate:android:v1`, navigation contract tests and the Android bundle check after
changing this owner. See [route architecture](../../../../docs/android-v1-route-architecture.md).

Thread rows receive qualified link destinations and background preparation separately. Links navigate
from All/project lists and dismiss to the thread from detail/child destinations, preserving the
current screen key on repeat selection and returning Back to the catalog or retained search.
`ui/AppLink` is the neutral Expo Link rendering boundary; features never dispatch Router commands.
Search-hit selection remains an explicit session-creating command with its existing push/replace policy.
