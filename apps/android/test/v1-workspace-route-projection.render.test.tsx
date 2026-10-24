import { projectWorkspaceRoutes } from "../src/routeComposition/workspaceRouteProjection";

it("keeps a PR catalog authoritative below a Projects overlay", () => {
  expect(projectWorkspaceRoutes([{ name: "pulls/index" }, { name: "projects/index" }], 1)).toEqual({
    focusedRouteName: "projects/index",
    overlayFocused: true,
    primary: { kind: "catalog", mode: "pullRequests" },
  });
});

it("keeps a PR detail authoritative below a route-owned overlay", () => {
  expect(
    projectWorkspaceRoutes(
      [
        { name: "pulls/index" },
        { name: "pulls/[connectionId]/[pullRequestKey]/changes" },
        { name: "projects/index" },
      ],
      2,
    ),
  ).toEqual({
    focusedRouteName: "projects/index",
    overlayFocused: true,
    primary: { kind: "detail", mode: "pullRequests" },
  });
});

it("does not infer Threads merely because an overlay is not a PR route", () => {
  expect(projectWorkspaceRoutes([{ name: "(lists)" }, { name: "settings/index" }], 1)).toEqual({
    focusedRouteName: "settings/index",
    overlayFocused: true,
    primary: { kind: "catalog", mode: "threads" },
  });
});
