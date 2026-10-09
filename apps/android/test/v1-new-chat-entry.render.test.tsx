import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import V1NewThreadRoute from "../app/(workspace)/new";
import { newChatDefaultServer } from "../src/features/projects/newChatEntry";
import { newThreadService } from "../src/services/threads/newThreadService";
import type { ThreadListServer } from "../src/features/connections/connectionPresentation";

const mockResources = {
  list: { loadedThreadSummaries: [], scopedThreads: [], servers: [], listState: {setThreadListMode: jest.fn()}, selectThread: jest.fn() },
  connections: [], desktop: false, pendingRequests: [], runtime: {}, recovery: {createUnsupportedFixThread: jest.fn()}, openBrowser: jest.fn(),
};
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({useWorkspaceRouteResources: () => mockResources}));
jest.mock("../src/data/workspace-runtime", () => ({workspaceRuntime: {native: false}}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({workspaceFeatures: {}}));
jest.mock("../src/features/workspace/WorkspaceConversationProviders", () => ({WorkspaceConversationProviders: ({children}: {children: ReactNode}) => children}));
jest.mock("../src/features/conversation/ConversationWorkspace", () => {
  const {Text,View} = jest.requireActual<typeof import("react-native")>("react-native");
  return ({
  ActiveWorkspaceConversation: ({destination}: {destination: {draft: {id: string, connectionId: string, cwd: string|null}}}) => <View><Text>Chat draft</Text><Text>{destination.draft.connectionId}</Text><Text>{destination.draft.cwd}</Text></View>,
});
});
const servers: ThreadListServer[] = [
  {id:"orbit",name:"Orbit",iconId:"desktop",status:"offline"},
  {id:"lab",name:"Lab",iconId:"cloud",status:"live"},
];
afterEach(() => newThreadService.dispose());

it("renders the draft immediately after New Chat entry without a project sheet", () => {
  const connectionId = newChatDefaultServer(null, servers);
  if (connectionId === null) throw new Error("Expected a draft server");
  newThreadService.resumeOrOpen(connectionId, null);
  const view = render(<V1NewThreadRoute />);
  expect(view.getByText("Chat draft")).toBeVisible();
  expect(view.getByText("lab")).toBeVisible();
  expect(view.queryByText("Choose project")).toBeNull();
});

it("resumes the existing draft with its identity and chosen project", () => {
  const draft = newThreadService.open("orbit", "/work/project");
  newThreadService.resumeOrOpen("lab", "/other/project");
  const view = render(<V1NewThreadRoute />);
  expect(newThreadService.current()).toBe(draft);
  expect(view.getByText("/work/project")).toBeVisible();
  expect(view.queryByText("Choose project")).toBeNull();
});

it("uses scoped server context even when that server is offline", () => {
  expect(newChatDefaultServer("orbit", servers)).toBe("orbit");
  expect(newChatDefaultServer("deleted", servers)).toBe("lab");
  expect(newChatDefaultServer(null, [])).toBeNull();
});
