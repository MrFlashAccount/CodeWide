import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "index" };
const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function AgentsLayout(): React.JSX.Element {
  return <Stack screenOptions={SCREEN_OPTIONS} />;
}
