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

Run `pnpm validate:android:v1`, navigation contract tests and the Android bundle check after
changing this owner. See [route architecture](../../../../docs/android-v1-route-architecture.md).

Thread rows receive qualified link destinations and background preparation separately. Links navigate
from All/project lists and dismiss to the thread from detail/child destinations, preserving the
current screen key on repeat selection and returning Back to the catalog or retained search.
`ui/AppLink` is the neutral Expo Link rendering boundary; features never dispatch Router commands.
Search-hit selection remains an explicit session-creating command with its existing push/replace policy.
