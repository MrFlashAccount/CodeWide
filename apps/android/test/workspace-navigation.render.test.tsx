import { useSelector } from "@legendapp/state/react";
import { act, render } from "@testing-library/react-native";
import { Suspense, use } from "react";
import { Text } from "react-native";

import { createThreadNavigationModel } from "../src/data/thread-navigation-model";
import {
  WorkspaceConversationHost,
  WorkspaceThreadListVisibility,
} from "../src/ui/WorkspaceConversationHost";

it("switches only the destination and affected row selectors, not the workspace or sidebar owner", async () => {
  const navigation = createThreadNavigationModel();
  const renderWorkspace = jest.fn();
  const renderSidebar = jest.fn();
  const renderRow = jest.fn();
  function Row({ id }: { id: string }) {
    const selected = useSelector(() => navigation.selection$.id.get() === id);
    renderRow(id);
    return <Text>{`${id}:${selected}`}</Text>;
  }
  function Sidebar() {
    renderSidebar();
    return (
      <>
        <Row id="a" />
        <Row id="b" />
        <Row id="c" />
      </>
    );
  }
  function Workspace() {
    renderWorkspace();
    return (
      <>
        <WorkspaceThreadListVisibility navigation={navigation} desktop>
          <Sidebar />
        </WorkspaceThreadListVisibility>
        <WorkspaceConversationHost
          navigation={navigation}
          renderConversation={(destination) => (
            <Text>
              {destination.kind === "thread" ? `conversation:${destination.key}` : destination.kind}
            </Text>
          )}
        />
      </>
    );
  }
  const view = render(<Workspace />);
  const workspaceBaseline = renderWorkspace.mock.calls.length;
  const sidebarBaseline = renderSidebar.mock.calls.length;
  await act(async () => {
    navigation.select("a");
  });
  renderRow.mockClear();
  await act(async () => {
    navigation.select("b");
  });
  expect(view.getByText("conversation:b")).toBeTruthy();
  expect(view.getByText("a:false")).toBeTruthy();
  expect(view.getByText("b:true")).toBeTruthy();
  expect(renderRow.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
  expect(renderWorkspace).toHaveBeenCalledTimes(workspaceBaseline);
  expect(renderSidebar).toHaveBeenCalledTimes(sidebarBaseline);
});

it("restores the mobile list on back and retains the chosen destination across host remounts", async () => {
  const navigation = createThreadNavigationModel();
  function Workspace() {
    return (
      <>
        <WorkspaceThreadListVisibility navigation={navigation} desktop={false}>
          <Text>Threads</Text>
        </WorkspaceThreadListVisibility>
        <WorkspaceConversationHost
          navigation={navigation}
          renderConversation={(destination) =>
            destination.kind === "draft" ? <Text>{`draft:${destination.draft.id}`}</Text> : null
          }
        />
      </>
    );
  }
  const view = render(<Workspace />);
  expect(view.getByText("Threads")).toBeTruthy();
  await act(async () => {
    navigation.openDraft({ id: "new", serverId: "server", cwd: null, workspaceMode: "current" });
  });
  expect(view.queryByText("Threads")).toBeNull();
  expect(view.getByText("draft:new")).toBeTruthy();
  view.unmount();
  const remounted = render(<Workspace />);
  expect(remounted.getByText("draft:new")).toBeTruthy();
  expect(remounted.queryByText("Threads")).toBeNull();
  await act(async () => {
    navigation.select(null);
  });
  expect(remounted.getByText("Threads")).toBeTruthy();
  expect(remounted.queryByText("draft:new")).toBeNull();
});

it("does not reveal a stale suspended destination after a later chat was selected", async () => {
  const navigation = createThreadNavigationModel();
  const pending = Promise.withResolvers<string>();
  function SlowConversation() {
    return <Text>{use(pending.promise)}</Text>;
  }
  const view = render(
    <WorkspaceConversationHost
      navigation={navigation}
      renderConversation={(destination) => (
        <Suspense fallback={<Text>Loading A</Text>}>
          {destination.kind === "thread" && destination.key === "a" ? (
            <SlowConversation />
          ) : (
            <Text>Chat B</Text>
          )}
        </Suspense>
      )}
    />,
  );
  await act(async () => {
    navigation.select("a");
  });
  expect(view.getByText("Loading A")).toBeTruthy();
  await act(async () => {
    navigation.select("b");
  });
  expect(view.getByText("Chat B")).toBeTruthy();
  await act(async () => {
    pending.resolve("Stale A");
  });
  expect(view.getByText("Chat B")).toBeTruthy();
  expect(view.queryByText("Stale A")).toBeNull();
});
