import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import {
  portsDestination,
  serverDestination,
  serversDestination,
  threadDestination,
} from "../src/v2/features/navigation/routeDestinations";
import { replaceServerSelection } from "../src/v2/features/navigation/serverSelectionNavigation";
import { NewThreadScreen } from "../src/v2/features/threadList/NewThreadScreen";

interface MockNewThreadFormProps {
  onBack(): void;
  onComposerAction(action: "ports"): void;
  onThreadCreated(threadId: string): void;
}

function MockNewThreadForm(props: MockNewThreadFormProps): React.JSX.Element {
  return (
    <View>
      <Pressable accessibilityLabel="Open ports" onPress={() => props.onComposerAction("ports")}>
        <Text>Open ports</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Complete new thread"
        onPress={() => props.onThreadCreated("thread/created")}
      >
        <Text>Complete new thread</Text>
      </Pressable>
      <Pressable accessibilityLabel="Close new thread" onPress={props.onBack}>
        <Text>Close new thread</Text>
      </Pressable>
    </View>
  );
}

jest.mock("../src/v2/features/threadList/NewThreadForm", () => ({
  NewThreadForm: MockNewThreadForm,
}));

const serverId = savedServerId("server/one");

describe("V2 typed New Thread navigation", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("pushes secondary routes and replaces the allocation route with typed destinations", () => {
    const push = jest.spyOn(router, "push");
    const replace = jest.spyOn(router, "replace");
    render(<NewThreadScreen savedServerId={serverId} />);

    fireEvent.press(screen.getByLabelText("Open ports"));
    expect(push).toHaveBeenCalledWith(portsDestination(serverId));

    fireEvent.press(screen.getByLabelText("Complete new thread"));
    expect(replace).toHaveBeenCalledWith(
      threadDestination(qualifiedThread(serverId, threadId("thread/created"))),
    );
  });

  it("replaces server-selector state in both directions without growing the back stack", () => {
    const push = jest.spyOn(router, "push");
    const replace = jest.spyOn(router, "replace");

    replaceServerSelection(serverId);
    replaceServerSelection(null);

    expect(replace).toHaveBeenNthCalledWith(1, serverDestination(serverId));
    expect(replace).toHaveBeenNthCalledWith(2, serversDestination());
    expect(push).not.toHaveBeenCalled();
  });
});
