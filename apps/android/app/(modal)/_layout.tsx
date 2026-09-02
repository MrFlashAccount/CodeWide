import { Stack } from "expo-router";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

export default function ModalLayout(): React.JSX.Element {
  return <Stack screenOptions={SCREEN_OPTIONS} />;
}
