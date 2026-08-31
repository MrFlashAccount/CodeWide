import { Stack, useLocalSearchParams } from "expo-router";

import { requireSavedServerRouteParam } from "../../../../src/v2/features/navigation/routeParams";

export const unstable_settings = { initialRouteName: "index" };

export default function SavedServerLayout(): React.JSX.Element {
  requireSavedServerRouteParam(useLocalSearchParams().savedServerId);
  return <Stack screenOptions={{ headerShown: false }} />;
}
