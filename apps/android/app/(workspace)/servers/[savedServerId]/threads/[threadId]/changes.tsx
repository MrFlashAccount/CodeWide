import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { ChangesScreen } from "../../../../../../src/v2/features/changes/ChangesScreen";
import { qualifiedThreadRouteParams } from "../../../../../../src/v2/features/navigation/routeParams";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "#0F0F0F" },
  headerShown: false,
  presentation: "fullScreenModal",
} as const;

export default function ThreadChangesRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/changes">();
  const owner = qualifiedThreadRouteParams(params);
  if (owner === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <ChangesScreen owner={owner} />
    </>
  );
}
