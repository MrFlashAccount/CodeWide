import { Stack, usePathname } from "expo-router";

import { RecoverableRenderBoundary } from "../../../../../../src/v2/ui/RecoverableRenderBoundary";

export const unstable_settings = { anchor: "index", initialRouteName: "index" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function ThreadLayout(): React.JSX.Element {
  const pathname = usePathname();
  return (
    <RecoverableRenderBoundary
      context={`Route: ${pathname}`}
      label="Thread route"
      resetKey={pathname}
      scope="surface"
    >
      <Stack screenOptions={SCREEN_OPTIONS} />
    </RecoverableRenderBoundary>
  );
}
