import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "servers" };

export default function WorkspaceLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
