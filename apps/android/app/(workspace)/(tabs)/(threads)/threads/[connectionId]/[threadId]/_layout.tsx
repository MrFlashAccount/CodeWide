import {
  Stack,
  useGlobalSearchParams,
  useIsFocused,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";

import { RouteUnavailable } from "../../../../../../../src/components/navigation/RouteUnavailable";
import { ConversationRouteNavigationContext } from "../../../../../../../src/features/conversation/conversationRouteNavigation";
import {
  routeSessionIdParam,
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../../../../../../../src/services/threads/threadRouteParams";
import type { PullRequestKey } from "../../../../../../../src/data/forgeContract";
import { useEvent } from "../../../../../../../src/react/useEvent";
import { LinkedPullRequestChipProvider } from "../../../../../../../src/routeComposition/LinkedPullRequestChipProvider";
import { usePullRequestNavigation } from "../../../../../../../src/routeComposition/pullRequestNavigation";
import { ThreadDestinationActiveContext } from "../../../../../../../src/routeComposition/threadDestinationActive";
import { useThreadRouteNavigation } from "../../../../../../../src/routeComposition/threadRouteNavigation";
import {
  v1FullscreenScreenOptions,
  v1RouteScreenOptions,
  v1SheetScreenOptions,
} from "../../../../../../../src/routeComposition/WorkspaceShell.styles";
import { isV1ThreadContextPath } from "../../../../../../../src/routeComposition/WorkspaceRouteModel";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "index", initialRouteName: "index" };

/** Keeps the active conversation and its Router capability mounted under child destinations. */
export default function V1ThreadLayout(): React.JSX.Element {
  const router = useRouter();
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
  const active = useIsFocused();
  const pullRequestNavigation = usePullRequestNavigation();
  // Child routes (subagents) cover the thread, so their chip opens the PR in Pull requests; the
  // thread screen itself opens it beside the chat instead.
  const openPullRequest = useEvent((pullRequest: PullRequestKey): void => {
    if (parsed.status === "valid") {
      pullRequestNavigation.openPullRequest(parsed.value.connectionId.value, pullRequest);
    }
  });
  if (parsed.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={() => {
          router.dismissTo("/");
        }}
        title="Thread unavailable"
      />
    );
  }
  const parsedSearchSessionId = routeSessionIdParam(raw.globalSearchSessionId);
  return (
    <ThreadDestinationActiveContext.Provider value={active}>
      <LinkedPullRequestChipProvider
        connectionId={parsed.value.connectionId.value}
        onOpen={openPullRequest}
        threadId={parsed.value.threadId.value}
        visiblePullRequest={null}
      >
        <ValidV1ThreadLayout
          globalSearchSessionId={
            parsedSearchSessionId.status === "valid" ? parsedSearchSessionId.value.value : null
          }
          params={parsed.value}
        />
      </LinkedPullRequestChipProvider>
    </ThreadDestinationActiveContext.Provider>
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
