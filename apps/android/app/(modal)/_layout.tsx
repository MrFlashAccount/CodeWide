import { Stack } from "expo-router";

const SCREEN_OPTIONS = { headerShown: false };

export default function ModalLayout(): React.JSX.Element {
  return <Stack screenOptions={SCREEN_OPTIONS} />;
}
