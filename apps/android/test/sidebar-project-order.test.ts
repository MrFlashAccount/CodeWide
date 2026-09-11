import { describe, expect, it } from "vitest";
import { decodeProjectOrder, moveSidebarProject, orderSidebarProjects } from "../src/data/sidebar-project-order";

describe("sidebar project order", () => {
  it("replays saved order across catalog refreshes without mixing identical paths on different servers", () => {
    const projects = [{ key: "a:/one" }, { key: "a:/two" }, { key: "b:/one" }];
    const order = moveSidebarProject([], projects.map((project) => project.key), "a:/two", -1);
    const restored = decodeProjectOrder(JSON.stringify(order));
    expect(orderSidebarProjects(projects, restored).map((project) => project.key)).toEqual(["a:/two", "a:/one", "b:/one"]);
    expect(orderSidebarProjects([...projects, { key: "a:/new" }], restored).at(-1)?.key).toBe("a:/new");
  });
  it("preserves hidden servers and makes edge moves a no-op", () => {
    const saved = ["b:/one", "a:/one", "a:/two"];
    expect(moveSidebarProject(saved, ["a:/one", "a:/two"], "a:/two", -1)).toEqual(["a:/two", "a:/one", "b:/one"]);
    expect(moveSidebarProject(saved, saved, "b:/one", -1)).toEqual(saved);
    expect(decodeProjectOrder("invalid")).toEqual([]);
    expect(decodeProjectOrder('[1,"a:/one",null]')).toEqual(["a:/one"]);
  });
});
