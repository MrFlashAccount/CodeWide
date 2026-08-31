import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "index" };

export default function ThreadLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
