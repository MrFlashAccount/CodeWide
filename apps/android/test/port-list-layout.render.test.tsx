import type {PortForwardingManagerProps,PortForwardingProfile} from "../src/features/ports/portForwardingContract";
import { LegendList } from "@legendapp/list/react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import {
  PortForwardingManager,
} from "../src/features/ports/PortForwardingManager";
import { AppListRow } from "../src/ui/AppListRow";
import { listRowHeight } from "../src/ui/AppListRow.types";

function discoveredPort(port: number): PortForwardingManagerProps["discoveredPorts"][number] {
  return {
    port, name: "Dev server", group: "Development", details: "", process: "node",
    pid: 42, cwd: null, kind: "node", forwardingKey: port.toString(16).padStart(64, "0"),
    defaultForwardingEnabled: true,
  };
}

const profile: PortForwardingProfile = {
  id: "profile",
  label: "Dev server",
  remoteHost: "127.0.0.1",
  remotePort: 3000,
  preferredLocalPort: null,
  localPort: 43000,
  status: "live",
  error: null,
  serviceKey: null,
  preference: "included",
  enabled: true,
  previewUrl: "http://127.0.0.1:43000/",
};
const defaults: PortForwardingManagerProps = {
  serverName: "Test",
  profiles: [profile],
  discoveredPorts: [discoveredPort(3000)],
  discoveryStatus: "ready",
  discoveryError: null,
  onOpen: jest.fn(),
  onSelectPort: jest.fn(),
  onExcludePort: jest.fn(),
  onAdd: jest.fn(),
  onEdit: jest.fn(),
  onStart: jest.fn(),
  onStop: jest.fn(),
  onReconnect: jest.fn(),
  onRemove: jest.fn(),
  onSetPreference: jest.fn(),
};

it("supplies exact sizes for individual ports and headers, not whole groups or estimates", () => {
  const view = render(<PortForwardingManager {...defaults} />);
  const list = view.UNSAFE_getByType(LegendList);
  expect(list.props.estimatedItemSize).toBeUndefined();
  expect(list.props.recycleItems).toBe(true);
  expect(list.props.drawDistance).toBe(360);
  expect(list.props.data).toHaveLength(2);
  expect(list.props.getFixedItemSize(list.props.data[0])).toBe(36);
  expect(list.props.getFixedItemSize(list.props.data[1])).toBe(listRowHeight.double);
  fireEvent.press(view.getByLabelText("Dev server, Live"));
  expect(defaults.onOpen).toHaveBeenCalledWith(profile);
});

it("rounds only the outer rows in a port group", () => {
  const profiles = [
    { ...profile, id: "first", label: "First", remotePort: 3001 },
    { ...profile, id: "middle", label: "Middle", remotePort: 3002 },
    { ...profile, id: "last", label: "Last", remotePort: 3003 },
  ];
  const view = render(<PortForwardingManager {...defaults} profiles={profiles}
    discoveredPorts={profiles.map((entry) => discoveredPort(entry.remotePort))} />);
  expect(view.UNSAFE_getAllByType(AppListRow).map((row) => row.props.position)).toEqual([
    "first",
    "middle",
    "last",
  ]);
});

it("reserves a fixed two-line error area and updates it when a port recovers", () => {
  const view = render(
    <PortForwardingManager
      {...defaults}
      profiles={[{ ...profile, status: "error", error: "Upstream closed" }]}
    />,
  );
  let list = view.UNSAFE_getByType(LegendList);
  expect(view.getByText("Upstream closed")).toBeVisible();
  expect(list.props.getFixedItemSize(list.props.data[1])).toBe(listRowHeight.double + 52);
  view.rerender(<PortForwardingManager {...defaults} />);
  list = view.UNSAFE_getByType(LegendList);
  expect(view.queryByText("Upstream closed")).toBeNull();
  expect(list.props.getFixedItemSize(list.props.data[1])).toBe(listRowHeight.double);
});

it("removes disappeared services from the visible list even when a stale profile remains", () => {
  const view = render(<PortForwardingManager {...defaults} />);
  expect(view.getByLabelText("Dev server, Live")).toBeVisible();
  view.rerender(<PortForwardingManager {...defaults} discoveredPorts={[]} />);
  expect(view.queryByLabelText("Dev server, Live")).toBeNull();
  expect(view.queryByText("Saved ports")).toBeNull();
  expect(view.getByText("Active 0")).toBeVisible();
});

it("keeps exclusion separate from forwarding and restores both actions after failure", async () => {
  const candidate = { ...discoveredPort(3000), defaultForwardingEnabled: false };
  let rejectExclusion = (_cause: Error): void => {};
  const exclusion = new Promise<void>((_resolve, reject) => {
    rejectExclusion = reject;
  });
  const onSelectPort = jest.fn(async () => {});
  const onExcludePort = jest.fn(() => exclusion);
  const view = render(<PortForwardingManager {...defaults} profiles={[]}
    discoveredPorts={[candidate]} onSelectPort={onSelectPort} onExcludePort={onExcludePort} />);
  fireEvent.press(view.getByText("Available 1"));
  fireEvent.press(view.getByLabelText("Exclude Dev server port 3000"));
  expect(onExcludePort).toHaveBeenCalledWith(candidate);
  expect(onSelectPort).not.toHaveBeenCalled();
  expect(view.getByLabelText("Forward Dev server port 3000")).toBeDisabled();
  expect(view.queryByLabelText("Exclude Dev server port 3000")).toBeNull();
  await act(async () => { rejectExclusion(new Error("Exclusion failed")); });
  const failureHeader = view.UNSAFE_getByType(LegendList).props.ListHeaderComponent;
  expect(view.getByLabelText("Exclude Dev server port 3000")).toBeVisible();
  fireEvent.press(view.getByLabelText("Forward Dev server port 3000"));
  await waitFor(() => expect(onSelectPort).toHaveBeenCalledWith(candidate));
  expect(onExcludePort).toHaveBeenCalledTimes(1);
  // The virtual-list test host mounts rows only; render the published header separately.
  expect(render(failureHeader).getByText("Exclusion failed")).toBeVisible();
});

it("keeps profile actions independently anchored without opening its preview", async () => {
  const onOpen = jest.fn();
  const onStop = jest.fn(async () => {});
  const view = render(<PortForwardingManager {...defaults} onOpen={onOpen} onStop={onStop} />);
  fireEvent.press(view.getByLabelText("Forwarding actions Dev server"));
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Forwarding actions Dev server: Stop"));
  await waitFor(() => expect(onStop).toHaveBeenCalledWith(profile.id));
  expect(onOpen).not.toHaveBeenCalled();
});
