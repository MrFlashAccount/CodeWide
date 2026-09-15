import { fireEvent, render } from "@testing-library/react-native";

import { SearchFilters, type SearchFilterValue, type SearchProject } from "../src/features/search/SearchFilters";

const empty: SearchFilterValue = { serverId: "", threadId: "", project: "", from: "", until: "" };
const servers = [{ id: "one", name: "Buddy" }, { id: "two", name: "Work" }];
const projects: readonly SearchProject[] = [
  { id: "one:other", serverId: "one", path: "/other", name: "Other project", subtitle: "Buddy · /other", pinned: false },
  { id: "two:work", serverId: "two", path: "/work", name: "Pinned Work", subtitle: "Work · /work", pinned: true },
  { id: "one:work", serverId: "one", path: "/work", name: "Pinned Buddy", subtitle: "Buddy · /work", pinned: true },
];

it("puts pinned projects first and keeps same-path projects bound to their server", () => {
  const change = jest.fn();
  const view = render(<SearchFilters value={empty} servers={servers} threads={[]} projects={projects} onChange={change} onPickDate={jest.fn()} />);
  fireEvent.press(view.getByLabelText("Search project"));
  const options = view.getAllByRole("radio");
  expect(options).toHaveLength(4);
  // The first choice clears the filter; saved pin order follows unchanged.
  fireEvent.press(options[1]);
  expect(change).toHaveBeenLastCalledWith({ ...empty, project: "/work", serverId: "two" });
  fireEvent.press(view.getByLabelText("Search project"));
  fireEvent.press(view.getByText("Pinned Buddy"));
  expect(change).toHaveBeenLastCalledWith({ ...empty, project: "/work", serverId: "one" });
  fireEvent.press(view.getByLabelText("Search project"));
  expect(view.getByText("Other project")).toBeTruthy();
});

it("filters projects by server and clears an incompatible project when switching server", () => {
  const change = jest.fn();
  const value = { ...empty, serverId: "one", project: "/work", threadId: "chat" };
  const view = render(<SearchFilters value={value} servers={servers} threads={[]} projects={projects} onChange={change} onPickDate={jest.fn()} />);
  fireEvent.press(view.getByLabelText("Search project"));
  expect(view.queryByText("Pinned Work")).toBeNull();
  fireEvent.press(view.getByLabelText("Search server"));
  fireEvent.press(view.getByText("Work"));
  expect(change).toHaveBeenLastCalledWith({ ...empty, serverId: "two" });
});

it("opens calendars for both bounds and clears dates without text entry", () => {
  const pick = jest.fn();
  const change = jest.fn();
  const value = { ...empty, from: "2026-09-07", until: "2026-09-09" };
  const view = render(<SearchFilters value={value} servers={servers} threads={[]} projects={projects} onChange={change} onPickDate={pick} />);
  fireEvent.press(view.getByLabelText("From date"));
  expect(pick).toHaveBeenLastCalledWith("from");
  fireEvent.press(view.getByLabelText("Through date"));
  expect(pick).toHaveBeenLastCalledWith("until");
  fireEvent.press(view.getByLabelText("Clear from date"));
  expect(change).toHaveBeenLastCalledWith({ ...value, from: "" });
  expect(view.queryByPlaceholderText("YYYY-MM-DD")).toBeNull();
  expect(view.queryByLabelText("Project path filter")).toBeNull();
});
