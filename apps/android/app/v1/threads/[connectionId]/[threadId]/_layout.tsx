import {
  Stack,
  useGlobalSearchParams,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";

import { RouteUnavailable } from "../../../../../src/components/navigation/RouteUnavailable";
import { workspaceRuntime } from "../../../../../src/data/workspace-runtime";
import { ConversationRouteNavigationContext } from "../../../../../src/features/conversation/conversationRouteNavigation";
import { useWorkspaceRuntime } from "../../../../../src/features/workspace/useWorkspaceRuntime";
import {
  routeSessionIdParam,
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../../../../../src/services/threads/threadRouteParams";
import { useThreadRouteNavigation } from "./threadRouteNavigation";
import {
  v1FullscreenScreenOptions,
  v1RouteScreenOptions,
  v1SheetScreenOptions,
} from "../../../V1WorkspaceShell.styles";
import { isV1ThreadContextPath } from "../../../V1WorkspaceRouteModel";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "index", initialRouteName: "index" };

/** Keeps the active conversation and its Router capability mounted under child destinations. */
export default function V1ThreadLayout(): React.JSX.Element {
  const router = useRouter();
  useWorkspaceRuntime();
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<{
    connectionId?: string | string[];
    globalSearchSessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const localParams = useLocalSearchParams<{
    connectionId?: string | string[];
    globalSearchSessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const raw = isV1ThreadContextPath(pathname) ? globalParams : localParams;
  const parsed = v1ThreadRouteParams(raw);
  if (parsed.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Thread unavailable"
      />
    );
  }
  const visibility = workspaceRuntime.globalSupervisorVisibility;
  if (
    visibility === null ||
    !visibility.allowsOrdinaryRef(parsed.value.connectionId.value, parsed.value.threadId.value)
  ) {
    return (
      <RouteUnavailable
        message="This system thread is available only through Global Voice Mode."
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Thread unavailable"
      />
    );
  }
  const parsedSearchSessionId = routeSessionIdParam(raw.globalSearchSessionId);
  return (
    <ValidV1ThreadLayout
      globalSearchSessionId={
        parsedSearchSessionId.status === "valid" ? parsedSearchSessionId.value.value : null
      }
      params={parsed.value}
    />
  );
}

function ValidV1ThreadLayout({
  globalSearchSessionId,
  params,
}: {
  readonly globalSearchSessionId: string | null;
  readonly params: V1ThreadRouteParams;
}): React.JSX.Element {
  const router = useRouter();
  const navigation = useThreadRouteNavigation(router, params, globalSearchSessionId);
  return (
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <Stack screenOptions={v1RouteScreenOptions}>
        <Stack.Screen name="agents/index" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="agents/[agentThreadId]" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="attachments/index" options={v1SheetScreenOptions} />
        <Stack.Screen name="changes/index" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="changes/turns/[turnId]" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="content/[sessionId]" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="controls/model" options={v1SheetScreenOptions} />
        <Stack.Screen name="controls/permissions" options={v1SheetScreenOptions} />
        <Stack.Screen name="controls/skills" options={v1SheetScreenOptions} />
        <Stack.Screen name="documents/[sessionId]" options={v1FullscreenScreenOptions} />
        <Stack.Screen name="goal" options={v1SheetScreenOptions} />
        <Stack.Screen name="ports" options={v1SheetScreenOptions} />
        <Stack.Screen name="queue" options={v1SheetScreenOptions} />
        <Stack.Screen name="review" options={v1SheetScreenOptions} />
        <Stack.Screen name="runtime" options={v1SheetScreenOptions} />
        <Stack.Screen name="terminal" options={v1FullscreenScreenOptions} />
      </Stack>
    </ConversationRouteNavigationContext.Provider>
  );
}
