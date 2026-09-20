import { act, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";

import { RouteFullscreenOverlay } from "../src/components/navigation/RouteFullscreenOverlay";
import {
  ConversationRouteFullscreenOverlay,
  ConversationRouteNavigationBoundary,
} from "../src/features/conversation/ConversationRouteFullscreenOverlay";
import {
  ConversationRouteNavigationContext,
  useConversationRouteNavigation,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";

function RouteHarness({
  onDismiss,
  renderRoute,
}: {
  readonly onDismiss: () => void;
  readonly renderRoute: (close: () => void) => ReactElement | null;
}): React.JSX.Element {
  return (
    <AppFullscreenOverlayProvider>
      <RouteFullscreenOverlay onDismiss={onDismiss} render={renderRoute} scope="route-test" />
    </AppFullscreenOverlayProvider>
  );
}

it("dismisses Router history when fullscreen content closes", () => {
  const onDismiss = jest.fn();
  let closeRoute: (() => void) | null = null;
  const renderRoute = jest.fn((close: () => void) => {
    closeRoute = close;
    return null;
  });
  const view = render(<RouteHarness onDismiss={onDismiss} renderRoute={renderRoute} />);

  expect(renderRoute).toHaveBeenCalledTimes(1);
  act(() => {
    closeRoute?.();
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("closes the fullscreen entry without navigating during route teardown", () => {
  const onDismiss = jest.fn();
  const view = render(<RouteHarness onDismiss={onDismiss} renderRoute={() => null} />);

  view.unmount();

  expect(onDismiss).not.toHaveBeenCalled();
});

it("restores captured thread-route navigation below a detached overlay host", () => {
  const navigation: ConversationRouteNavigation = {
    openAgents: jest.fn(),
    openAttachments: jest.fn(),
    openChanges: jest.fn(),
    openCodeDocument: jest.fn(),
    openContent: jest.fn(),
    openDocument: jest.fn(),
    openDrawing: jest.fn(),
    openTerminal: jest.fn(),
    openTool: jest.fn(),
    openTurnChanges: jest.fn(),
  };
  const boundary = render(
    <ConversationRouteNavigationBoundary navigation={navigation}>
      <ConversationRouteNavigationProbe />
    </ConversationRouteNavigationBoundary>,
  );

  expect(boundary.getByText("Conversation navigation ready")).toBeTruthy();

  const overlay = render(
    <AppFullscreenOverlayProvider>
      <ConversationRouteNavigationContext.Provider value={navigation}>
        <ConversationRouteFullscreenOverlay
          onDismiss={jest.fn()}
          render={() => <Text>Detached content</Text>}
          scope="conversation-route-test"
        />
      </ConversationRouteNavigationContext.Provider>
    </AppFullscreenOverlayProvider>,
  );
  expect(overlay.toJSON()).toBeNull();
});

function ConversationRouteNavigationProbe(): React.JSX.Element {
  useConversationRouteNavigation();
  return <Text>Conversation navigation ready</Text>;
}
