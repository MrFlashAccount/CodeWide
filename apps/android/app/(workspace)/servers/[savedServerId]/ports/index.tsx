import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { PortsScreen } from "../../../../../src/v2/features/ports/PortsScreen";
import { savedServerRouteParam } from "../../../../../src/v2/features/navigation/routeParams";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

export default function PortsRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/ports">();
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (savedServerId === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <PortsScreen savedServerId={savedServerId} />
    </>
  );
}
