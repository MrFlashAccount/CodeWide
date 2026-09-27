import { act, render } from "@testing-library/react-native";
import { useState } from "react";
import { BackHandler, Text, View } from "react-native";

import { useConversationAndroidBack } from "../src/features/conversation/timeline/overlayScrollOwnership";
import { useAndroidBackHandler } from "../src/ui/use-android-back-handler";

type BackListener = () => boolean | null | undefined;

let backListeners: BackListener[] = [];
const underlyingBack = jest.fn(() => false);

beforeEach(() => {
  underlyingBack.mockClear();
  backListeners = [underlyingBack];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    backListeners.push(listener);
    return {
      remove: () => {
        backListeners = backListeners.filter((candidate) => candidate !== listener);
      },
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pressSystemBack(): boolean {
  for (let index = backListeners.length - 1; index >= 0; index -= 1) {
    if (backListeners[index]?.()) {
      return true;
    }
  }
  return false;
}

function ConversationBackHarness({
  compact,
  initialOverlayVisible = false,
  initialQueueExpanded = false,
  initialSearchVisible = false,
  onRouteBack,
}: {
  readonly compact: boolean;
  readonly initialOverlayVisible?: boolean;
  readonly initialQueueExpanded?: boolean;
  readonly initialSearchVisible?: boolean;
  readonly onRouteBack?: () => void;
}): React.JSX.Element {
  const [overlayVisible, setOverlayVisible] = useState(initialOverlayVisible);
  const [queueExpanded, setQueueExpanded] = useState(initialQueueExpanded);
  const [searchVisible, setSearchVisible] = useState(initialSearchVisible);

  useConversationAndroidBack({
    closeInlineQueueOverlay: () => {
      setQueueExpanded(false);
    },
    closeThreadSearch: () => {
      setSearchVisible(false);
    },
    compact,
    inlineQueueExpanded: queueExpanded,
    onBack: onRouteBack,
    threadSearchVisible: searchVisible,
  });
  useAndroidBackHandler(overlayVisible, () => {
    setOverlayVisible(false);
  });

  return (
    <View>
      <Text>{overlayVisible ? "overlay-open" : "overlay-closed"}</Text>
      <Text>{queueExpanded ? "queue-open" : "queue-closed"}</Text>
      <Text>{searchVisible ? "search-open" : "search-closed"}</Text>
    </View>
  );
}

it("closes the deepest overlay, queue, and thread search before route navigation", () => {
  const onRouteBack = jest.fn();
  const view = render(
    <ConversationBackHarness
      compact
      initialOverlayVisible
      initialQueueExpanded
      initialSearchVisible
      onRouteBack={onRouteBack}
    />,
  );

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(view.getByText("overlay-closed")).toBeVisible();
  expect(view.getByText("queue-open")).toBeVisible();
  expect(view.getByText("search-open")).toBeVisible();
  expect(onRouteBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(view.getByText("queue-closed")).toBeVisible();
  expect(view.getByText("search-open")).toBeVisible();
  expect(onRouteBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(view.getByText("search-closed")).toBeVisible();
  expect(onRouteBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(onRouteBack).toHaveBeenCalledTimes(1);
  expect(underlyingBack).not.toHaveBeenCalled();
});

it("closes thread search on a wide conversation without claiming later Back", () => {
  const view = render(
    <ConversationBackHarness compact={false} initialSearchVisible onRouteBack={undefined} />,
  );

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(view.getByText("search-closed")).toBeVisible();
  expect(underlyingBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(false);
  });
  expect(underlyingBack).toHaveBeenCalledTimes(1);
});

it("closes compact thread search before repeated Back reaches route navigation", () => {
  const onRouteBack = jest.fn();
  const view = render(
    <ConversationBackHarness compact initialSearchVisible onRouteBack={onRouteBack} />,
  );

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(view.getByText("search-closed")).toBeVisible();
  expect(onRouteBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(onRouteBack).toHaveBeenCalledTimes(1);
  expect(underlyingBack).not.toHaveBeenCalled();
});

it("preserves ordinary compact route Back when no local surface is open", () => {
  const onRouteBack = jest.fn();
  render(<ConversationBackHarness compact onRouteBack={onRouteBack} />);

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(onRouteBack).toHaveBeenCalledTimes(1);
  expect(underlyingBack).not.toHaveBeenCalled();
});
