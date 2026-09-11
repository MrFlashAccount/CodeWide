import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { LegendList } from "@legendapp/list/react-native";
import type { ReactNode } from "react";
import { SkillsPicker } from "../src/ui/SkillsPicker";
import { parseCatalogSkills, assignSkillPlugins } from "../src/data/skill-catalog-adapter";
import { SkillPluginIcon } from "../src/ui/SkillPluginIcon";
import { listRowHeight } from "../src/ui/AppListRow.types";

// WHY: Node cannot mount the Expo sheet window; the actual list and row sizing remain under test.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BottomSheetView: View,
    BottomSheetScrollView: ScrollView,
  };
});

// WHY: Expo's filesystem bridge cannot initialize in Node; icon-less fixtures still exercise the real picker and image resource owner.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

afterEach(() => jest.restoreAllMocks());

const skills = assignSkillPlugins(parseCatalogSkills({ data: [{ skills: [
  { name: "inspect", path: "/inspect", enabled: true, description: "Inspect a change", scope: "repo" },
  { name: "write", path: "/write", enabled: true, description: "Write a summary", scope: "user" },
  { name: "disabled-skill", path: "/disabled", enabled: false, description: "Hidden", scope: "repo" },
] }] }), new Map([
  ["/inspect", { id: "tools", label: "Developer tools", icon: null }],
  ["/write", { id: "writing", label: "Writing", icon: null }],
]), true);

it("renders plugin sections, hides disabled skills and invokes the canonical skill on tap", () => {
  const onSelect = jest.fn();
  const view = render(<SkillsPicker skills={skills} loading={false} error={null} onSelect={onSelect} />);
  expect(view.getByText("Developer tools")).toBeVisible();
  expect(view.getByText("Writing")).toBeVisible();
  expect(view.queryByText("disabled-skill")).toBeNull();
  expect(view.queryByRole("radio")).toBeNull();
  const list = view.UNSAFE_getByType(LegendList);
  expect(list.props.recycleItems).toBe(true);
  for (const row of list.props.data) {
    expect(list.props.getFixedItemSize(row)).toBe(row.kind === "header" ? listRowHeight.single : listRowHeight.double);
  }
  expect(view.getByRole("button", { name: "inspect" })).toHaveStyle({ height: listRowHeight.double });
  fireEvent.press(view.getByRole("button", { name: "inspect" }));
  expect(onSelect).toHaveBeenCalledWith(skills[0]);
});

it("keeps search and source filters independent of plugin grouping", () => {
  const view = render(<SkillsPicker skills={skills} loading={false} error={null} onSelect={() => undefined} />);
  fireEvent.changeText(view.getByLabelText("Search skills"), "summary");
  expect(view.queryByText("Developer tools")).toBeNull();
  expect(view.getByText("Writing")).toBeVisible();
  fireEvent.press(view.getByLabelText("Clear skill search"));
  fireEvent.press(view.getByLabelText("Filter skills: All sources"));
  fireEvent.press(view.getByLabelText("Filter skills: Project"));
  expect(view.getByText("Developer tools")).toBeVisible();
  expect(view.queryByText("Writing")).toBeNull();
  fireEvent.press(view.getByLabelText("Clear skill source filter"));
  expect(view.getByText("Writing")).toBeVisible();
});

it("distinguishes loading, unavailable and an empty enabled catalog", () => {
  const view = render(<SkillsPicker skills={[]} loading error={null} onSelect={() => undefined} />);
  expect(view.queryByText("No enabled skills for this workspace")).toBeNull();
  view.rerender(<SkillsPicker skills={[]} loading={false} error="Server unavailable" onSelect={() => undefined} />);
  expect(view.getByText("Server unavailable")).toBeVisible();
  expect(view.queryByText("No enabled skills for this workspace")).toBeNull();
  view.rerender(<SkillsPicker skills={skills.filter((skill) => !skill.enabled)} loading={false} error={null} onSelect={() => undefined} />);
  expect(view.getByText("No enabled skills for this workspace")).toBeVisible();
});

it("loads plugin SVG artwork through authenticated host transfer, not a phone file path", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0L24 24" /></svg>', { headers: { "content-type": "image/svg+xml" } }));
  const getAccess = jest.fn(async () => ({ baseUrl: "https://companion.example", authorization: "Bearer test" }));
  render(<SkillPluginIcon plugin={{ id: "svg-plugin", label: "Example", icon: { kind: "path", path: "/plugins/example/logo.svg" } }} getTransferAccess={getAccess} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(getAccess).toHaveBeenCalled();
  const [url, options] = fetch.mock.calls[0] ?? [];
  expect(String(url)).toContain("https://companion.example/");
  expect(new Headers(options?.headers).get("authorization")).toBe("Bearer test");
});
