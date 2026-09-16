import { Slot, useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../src/components/navigation/RouteUnavailable";
import { ConversationRouteNavigationContext } from "../../../../../src/features/conversation/conversationRouteNavigation";
import {
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../../../../../src/services/threads/threadRouteParams";
import { useThreadRouteNavigation } from "./threadRouteNavigation";

/** Keeps the active conversation and its Router capability mounted under child destinations. */
export default function V1ThreadLayout(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsed = v1ThreadRouteParams(raw);
  if (parsed.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Thread unavailable"
      />
    );
  }
  return <ValidV1ThreadLayout params={parsed.value} />;
}

function ValidV1ThreadLayout({
  params,
}: {
  readonly params: V1ThreadRouteParams;
}): React.JSX.Element {
  const router = useRouter();
  const navigation = useThreadRouteNavigation(router, params);
  return (
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <Slot />
    </ConversationRouteNavigationContext.Provider>
  );
}
