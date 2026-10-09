import { act, fireEvent, render, within } from "@testing-library/react-native";
import { BrowserHomePorts } from "../src/features/ports/BrowserHomePorts";
import { BrowserHomeContentContext } from "../src/features/browser/BrowserHomeContentContext";
import { BrowserWorkspace } from "../src/features/browser/BrowserWorkspace";
import { BrowserTabsModel } from "../src/services/browser/browserTabsModel";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";
import type {
  NativeDiscoveredPort,
  NativePortForwardProfile,
} from "../src/native/native-transport";
import { Ionicons } from "@expo/vector-icons";

let mockProfiles: readonly NativePortForwardProfile[] = [];
let mockDiscoveredPorts: readonly NativeDiscoveredPort[] = [];
jest.mock("../src/data/native-port-forwarding-store", () => ({
  nativePortForwardingStore: {
    scope: (connectionId: string) => ({
      getSnapshot: () => ({
        profiles: mockProfiles.filter((profile) => profile.connectionId === connectionId),
      }),
    }),
  },
  useNativePortForwarding: () => ({
    discoveredPorts: mockDiscoveredPorts,
    profiles: mockProfiles,
    profilesStatus: "ready",
  }),
}));

function profile(
  connectionId: string,
  label: string,
  remotePort: number,
): NativePortForwardProfile {
  return {
    connectionId,
    enabled: true,
    error: null,
    id: `${connectionId}-${String(remotePort)}`,
    label,
    localPort: remotePort + 10_000,
    preference: "included",
    preferredLocalPort: null,
    previewUrl: `http://127.0.0.1:${String(remotePort + 10_000)}/`,
    remoteHost: "127.0.0.1",
    remotePort,
    serviceKey: null,
    status: "live",
    updatedAt: 0,
  };
}
afterEach(() => {
  mockProfiles = [];
  mockDiscoveredPorts = [];
});

function candidate(
  name: string,
  port: number,
  group: string,
  kind: NativeDiscoveredPort["kind"],
): NativeDiscoveredPort {
  return {
    cwd: null,
    defaultForwardingEnabled: true,
    details: "",
    forwardingKey: `${kind}:${String(port)}`,
    group,
    kind,
    name,
    pid: null,
    port,
    process: null,
  };
}

it("uses the Ports inventory groups and service icons in both grid and list", () => {
  const frontend = candidate("Frontend", 3000, "Development", "vite");
  const database = candidate("Database", 5432, "Containers", "docker");
  const manual = candidate("Manual", 8080, "Local services", "process");
  mockDiscoveredPorts = [frontend, database, manual];
  mockProfiles = [
    { ...profile("server-a", "Frontend", 3000), serviceKey: frontend.forwardingKey },
    { ...profile("server-a", "Database", 5432), serviceKey: database.forwardingKey },
    profile("server-a", "Manual", 8080),
  ];
  const view = render(<BrowserHomePorts connectionId="server-a" onNavigate={jest.fn()} />);
  const checkServices = () => {
    expect(view.getByText("Development")).toBeVisible();
    expect(view.getByText("Containers")).toBeVisible();
    expect(view.getByText("Local services")).toBeVisible();
    expect(
      within(view.getByLabelText("Open Frontend, port 3000")).UNSAFE_getByType(Ionicons).props.name,
    ).toBe("logo-nodejs");
    expect(
      within(view.getByLabelText("Open Database, port 5432")).UNSAFE_getByType(Ionicons).props.name,
    ).toBe("cube-outline");
  };
  checkServices();
  fireEvent.press(view.getByLabelText("Show ports as list"));
  checkServices();
});

it("offers grid/list shortcuts for only this server's live forwards and resolves the current destination on tap", () => {
  const first = profile("server-a", "Frontend", 3000);
  mockDiscoveredPorts = [candidate("Frontend", 3000, "Development", "vite")];
  mockProfiles = [
    first,
    profile("server-b", "Other server", 4000),
    { ...profile("server-a", "Stopped", 5000), status: "stopped" },
  ];
  const open = jest.fn();
  const view = render(<BrowserHomePorts connectionId="server-a" onNavigate={open} />);
  expect(view.getByText("Frontend")).toBeTruthy();
  expect(view.queryByText("Other server")).toBeNull();
  expect(view.queryByText("Stopped")).toBeNull();
  fireEvent.press(view.getByLabelText("Show ports as list"));
  expect(view.getByLabelText("Show ports as grid")).toBeTruthy();
  mockProfiles = [{ ...first, previewUrl: "http://127.0.0.1:23000/" }];
  fireEvent.press(view.getByLabelText("Open Frontend, port 3000"));
  expect(open).toHaveBeenLastCalledWith("http://127.0.0.1:23000/");
  mockProfiles = [];
  fireEvent.press(view.getByLabelText("Open Frontend, port 3000"));
  expect(open).toHaveBeenCalledTimes(1);
});

it("uses the same inventory admission rule as the Ports sheet", () => {
  const frontend = candidate("Frontend", 3000, "Development", "vite");
  mockProfiles = [{ ...profile("server-a", "Frontend", 3000), serviceKey: frontend.forwardingKey }];
  const view = render(<BrowserHomePorts connectionId="server-a" onNavigate={jest.fn()} />);
  expect(view.getByText("No forwarded ports yet. Enable a service in Ports.")).toBeVisible();
  expect(view.queryByText("Forwarded services")).toBeNull();
  mockDiscoveredPorts = [frontend];
  view.rerender(<BrowserHomePorts connectionId="server-a" onNavigate={jest.fn()} />);
  expect(view.getByText("Development")).toBeVisible();
  expect(view.getByText("Frontend")).toBeVisible();
});

it("opens a service inside the existing Home tab instead of creating another tab", () => {
  const first = profile("server-a", "Frontend", 3000);
  mockProfiles = [first];
  mockDiscoveredPorts = [candidate("Frontend", 3000, "Development", "vite")];
  const tabs = new BrowserTabsModel();
  const home = tabs.openHome();
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserHomeContentContext.Provider
        value={{
          connectionId: "server-a",
          render: (connectionId, onNavigate) => (
            <BrowserHomePorts connectionId={connectionId} onNavigate={onNavigate} />
          ),
        }}
      >
        <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
      </BrowserHomeContentContext.Provider>
    </AppFullscreenOverlayProvider>,
  );
  fireEvent.press(view.getByLabelText("Open Frontend, port 3000"));
  const state = tabs.state$.peek();
  expect(state.kind).toBe("tabs");
  if (state.kind !== "tabs") throw new Error("Expected an opened Home tab");
  expect(state.selected).toBe(home);
  expect(state.selected.destination?.url).toBe(first.previewUrl);
  expect(state.before).toHaveLength(0);
  expect(state.after).toHaveLength(0);
});

it("shows the empty and unscoped Home states without borrowing another server's services", () => {
  const view = render(<BrowserHomePorts connectionId="server-a" onNavigate={jest.fn()} />);
  expect(view.getByText("No forwarded ports yet. Enable a service in Ports.")).toBeTruthy();
  act(() => {
    mockProfiles = [profile("server-b", "Other server", 4000)];
  });
  view.rerender(<BrowserHomePorts connectionId={null} onNavigate={jest.fn()} />);
  expect(view.getByText("Open Browser from a chat to see its server ports")).toBeTruthy();
  expect(view.queryByText("Other server")).toBeNull();
});
