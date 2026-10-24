import { describe, expect, it } from "vitest";

import { parseActionCatalog, type ActionDescriptor } from "../src/data/forgeActionCatalog";
import {
  slotActions,
  type SlotLayout,
  type SlotTargets,
} from "../src/features/pullRequestDetail/actions/actionSlotting";
import { confirmationCopy } from "../src/features/pullRequestDetail/actions/confirmationCopy";
import { effectiveConfirmation } from "../src/features/pullRequestDetail/actions/confirmationPolicy";
import { action, overview91 } from "./fixtures/forgeWireFixtures";

function catalog(actions: readonly Record<string, unknown>[]): readonly ActionDescriptor[] {
  return parseActionCatalog({ actions, headRevision: "h" }, () => undefined)?.actions ?? [];
}

const phone: SlotLayout = { availableWidth: 1000, gap: 8, measure: () => 100, tablet: false };
const tablet: SlotLayout = { ...phone, tablet: true };
const noTargets: SlotTargets = { checkIds: new Set(), conflict: false, reviewThreadIds: new Set() };
const ids = (actions: readonly ActionDescriptor[]): readonly string[] =>
  actions.map((item) => item.actionId);

describe("action slotting", () => {
  const rowActions = catalog([
    action("p1", { order: 1, placement: "primary" }),
    action("p2", { order: 2, placement: "primary" }),
    action("s1", { order: 3 }),
    action("s2", { order: 4 }),
    action("s3", { order: 5 }),
    action("s4", { order: 6 }),
  ]);

  it("fills phone with 1 primary and 2 secondary; excess degrades primary → secondary → ⋯ in plugin order", () => {
    const slots = slotActions(rowActions, noTargets, phone);
    expect(ids(slots.primary)).toEqual(["p1"]);
    expect(ids(slots.secondary)).toEqual(["p2", "s1"]);
    expect(ids(slots.overflow)).toEqual(["s2", "s3", "s4"]);
  });

  it("fills tablet with 2 primary and 3 secondary", () => {
    const slots = slotActions(rowActions, noTargets, tablet);
    expect(ids(slots.primary)).toEqual(["p1", "p2"]);
    expect(ids(slots.secondary)).toEqual(["s1", "s2", "s3"]);
    expect(ids(slots.overflow)).toEqual(["s4"]);
  });

  it("keeps only as many as fit one line by measured width", () => {
    const slots = slotActions(rowActions, noTargets, { ...phone, availableWidth: 210 });
    expect(ids(slots.primary)).toEqual(["p1"]);
    expect(ids(slots.secondary)).toEqual(["p2"]);
    expect(ids(slots.overflow)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("sends verdicts to the dock (default first) and merge kinds to the merge card, never to the row", () => {
    const slots = slotActions(catalog(overview91.catalog.actions), noTargets, phone);
    expect(ids(slots.verdicts)).toEqual(["approve", "request", "comment"]);
    expect(ids(slots.merge)).toEqual(["merge"]);
    expect(slots.autoMerge?.actionId).toBe("auto");
    expect([...ids(slots.primary), ...ids(slots.secondary), ...ids(slots.overflow)]).not.toContain(
      "approve",
    );
  });

  it("puts an anchored action on its target, and in ⋯ when the target is missing", () => {
    const anchored = catalog([
      action("fix", { anchor: { checkId: "c1", kind: "checks" }, kind: "fixCi" }),
      action("rebase", { anchor: { kind: "conflict" }, kind: "rebase" }),
      action("reply", { anchor: { kind: "reviewThread", reviewThreadId: "rt" } }),
    ]);
    const present = slotActions(
      anchored,
      { checkIds: new Set(["c1"]), conflict: true, reviewThreadIds: new Set(["rt"]) },
      phone,
    );
    expect(ids(present.anchored.checks.get("c1") ?? [])).toEqual(["fix"]);
    expect(ids(present.anchored.conflict)).toEqual(["rebase"]);
    expect(ids(present.anchored.reviewThreads.get("rt") ?? [])).toEqual(["reply"]);
    const missing = slotActions(anchored, noTargets, phone);
    expect(ids(missing.overflow)).toEqual(["fix", "rebase", "reply"]);
  });

  it("places every action exactly once", () => {
    const actions = catalog(overview91.catalog.actions);
    const slots = slotActions(
      actions,
      { checkIds: new Set(["c-android"]), conflict: false, reviewThreadIds: new Set() },
      phone,
    );
    const placed = [
      ...slots.primary,
      ...slots.secondary,
      ...slots.overflow,
      ...slots.merge,
      ...slots.verdicts,
      ...(slots.autoMerge === null ? [] : [slots.autoMerge]),
      ...[...slots.anchored.checks.values()].flat(),
    ];
    expect(ids(placed).toSorted()).toEqual(ids(actions).toSorted());
  });
});

describe("confirmation policy", () => {
  it("raises merge and close to destructive even when the plugin says none", () => {
    const [merge, close] = catalog([
      action("m", { confirm: "none", kind: "merge" }),
      action("c", { confirm: "none", kind: "close" }),
    ]);
    expect(merge === undefined ? null : effectiveConfirmation(merge)).toBe("destructive");
    expect(close === undefined ? null : effectiveConfirmation(close)).toBe("destructive");
  });

  it("raises auto-merge and update branch to confirm, and never lowers a plugin level", () => {
    const [auto, update, extension] = catalog([
      action("a", { kind: "autoMerge", toggle: { on: false } }),
      action("u", { kind: "updateBranch" }),
      action("e", { confirm: "destructive" }),
    ]);
    expect(
      [auto, update, extension].map((item) =>
        item === undefined ? null : effectiveConfirmation(item),
      ),
    ).toEqual(["confirm", "confirm", "destructive"]);
  });

  it("names the forge host in every consequence", () => {
    for (const item of catalog(overview91.catalog.actions)) {
      expect(confirmationCopy(item, null, "github.com").consequence).toContain("github.com");
    }
  });
});
