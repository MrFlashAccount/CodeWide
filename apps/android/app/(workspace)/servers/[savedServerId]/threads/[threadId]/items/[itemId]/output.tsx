import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { useEvent } from "@/react/useEvent";
import { ItemOutputScreen } from "@/v2/features/conversation/ItemOutputScreen";
import { opaqueRouteParam, qualifiedThreadRouteParams } from "@/v2/features/navigation/routeParams";
import { copyPreviewText } from "@/v2/platform/preview/copyPreviewText";
import { colors } from "@/v2/theme";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: colors.background },
  headerShown: false,
  presentation: "fullScreenModal",
} as const;

export default function ItemOutputRoute(): React.JSX.Element {
  const params =
    useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/items/[itemId]/output">();
  const owner = qualifiedThreadRouteParams(params);
  const turnId = opaqueRouteParam(params.turnId);
  const itemId = opaqueRouteParam(params.itemId);
  const close = useEvent(() => router.back());
  if (owner === null || turnId === null || itemId === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <ItemOutputScreen
        copyText={copyPreviewText}
        itemId={itemId}
        onClose={close}
        owner={owner}
        turnId={turnId}
      />
    </>
  );
}
