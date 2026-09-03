import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { useEvent } from "@/react/useEvent";
import { ThreadChangeOutputScreen } from "@/v2/features/changes/ThreadChangeOutputScreen";
import type { ThreadChangeScope } from "@/v2/features/changes/threadChangeOutputResource";
import {
  qualifiedThreadRouteParams,
  workspacePathRouteParam,
} from "@/v2/features/navigation/routeParams";
import { copyPreviewText } from "@/v2/platform/preview/copyPreviewText";
import { colors } from "@/v2/theme";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: colors.background },
  headerShown: false,
  presentation: "fullScreenModal",
} as const;

export default function ThreadChangeOutputRoute(): React.JSX.Element {
  const params =
    useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/changes/output">();
  const owner = qualifiedThreadRouteParams(params);
  const path = workspacePathRouteParam(params.path);
  const scope = changeScopeRouteParam(params.scope);
  const close = useEvent(() => router.back());
  if (owner === null || path === null || scope === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <ThreadChangeOutputScreen
        copyText={copyPreviewText}
        onClose={close}
        owner={owner}
        path={path}
        scope={scope}
      />
    </>
  );
}

function changeScopeRouteParam(value: string | string[] | undefined): ThreadChangeScope | null {
  switch (value) {
    case "branch":
    case "lastTurn":
    case "session":
    case "staged":
    case "unstaged":
      return value;
    case undefined:
    default:
      return null;
  }
}
