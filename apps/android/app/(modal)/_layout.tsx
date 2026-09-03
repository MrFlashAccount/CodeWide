import { Redirect, router, Stack, usePathname } from "expo-router";

import { useUiGenerationSnapshot } from "../../src/boot/useUiGenerationSnapshot";
import { useEvent } from "../../src/react/useEvent";
import { RecoverableRenderBoundary } from "../../src/v2/ui/RecoverableRenderBoundary";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

export default function ModalLayout(): React.JSX.Element {
  const generation = useUiGenerationSnapshot();
  const pathname = usePathname();
  const dismiss = useEvent(() => router.back());
  if (generation.status !== "ready") return <Redirect href="/" />;
  if (generation.generation === "legacy") return <Redirect href="/legacy" />;
  return (
    <RecoverableRenderBoundary
      context={`Route: ${pathname}`}
      label="Modal route"
      onDismiss={dismiss}
      resetKey={pathname}
      scope="dialog"
    >
      <Stack screenOptions={SCREEN_OPTIONS} />
    </RecoverableRenderBoundary>
  );
}
