import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import V1ThreadLayout from "../app/(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout";
import { useConversationRouteNavigation } from "../src/features/conversation/conversationRouteNavigation";
import {
  clearMockRoutes,
  mockRouterHistory,
  registerMockRoute,
  resetMockRouter,
  setMockLocalSearchParams,
} from "./mocks/ExpoRouter";

function AttachmentLauncher(): React.JSX.Element {
  const navigation = useConversationRouteNavigation();
  return (
    <Pressable onPress={navigation.openAttachments}>
      <Text>Open attachments</Text>
    </Pressable>
  );
}

afterEach(() => {
  clearMockRoutes();
  setMockLocalSearchParams(null);
  resetMockRouter();
});

it("opens thread children for the current URL when the retained layout has stale local params", () => {
  const pathname = "/threads/[connectionId]/[threadId]";
  registerMockRoute(pathname, AttachmentLauncher);
  resetMockRouter({
    params: { connectionId: "server", threadId: "current" },
    pathname,
  });
  setMockLocalSearchParams({ connectionId: "server", threadId: "first" });

  const view = render(<V1ThreadLayout />);
  fireEvent.press(view.getByText("Open attachments"));

  expect(mockRouterHistory().at(-1)).toEqual({
    params: {
      connectionId: "server",
      sessionId: expect.stringMatching(/^attachments-/u),
      threadId: "current",
    },
    pathname: "/threads/[connectionId]/[threadId]/attachments",
  });
  view.unmount();
});
