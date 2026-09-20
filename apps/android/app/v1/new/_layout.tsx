import { Stack } from "expo-router";

import {
  v1FullscreenScreenOptions,
  v1RouteScreenOptions,
  v1SheetScreenOptions,
} from "../V1WorkspaceShell.styles";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "index", initialRouteName: "index" };

/** Keeps the draft conversation mounted while its control routes are presented. */
export default function V1NewThreadLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={v1RouteScreenOptions}>
      <Stack.Screen name="controls/model" options={v1SheetScreenOptions} />
      <Stack.Screen name="controls/permissions" options={v1SheetScreenOptions} />
      <Stack.Screen name="controls/skills" options={v1SheetScreenOptions} />
      <Stack.Screen name="content/[sessionId]" options={v1FullscreenScreenOptions} />
      <Stack.Screen name="documents/[sessionId]" options={v1FullscreenScreenOptions} />
    </Stack>
  );
}
