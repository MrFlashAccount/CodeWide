import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSkillCatalog } from "../src/data/load-skill-catalog";
import { parseCatalogSkills, parseInstalledSkillPlugins } from "../src/data/skill-catalog-adapter";
import { turnControlsCacheNeedsRepair } from "../src/data/turn-controls-loader";
import { skillPickerRows } from "../src/ui/skill-picker-model";

const rawSkill = (name: string, path: string, enabled = true, scope = "user") => ({ name, path, enabled, scope, description: "Long instructions", interface: { displayName: name, shortDescription: "Brief purpose" } });
const skillResponse = { data: [{ skills: [rawSkill("same", "/one/SKILL.md"), rawSkill("same", "/two/SKILL.md"), rawSkill("hidden", "/hidden/SKILL.md", false)] }] };
const installed = { marketplaces: [{ name: "market", path: "/market.json", plugins: [
  { id: "one", name: "one", installed: true, interface: { displayName: "First plugin", logoDark: "/icons/one.svg" } },
  { id: "two", name: "two", installed: true, interface: { displayName: "Second plugin", logoUrl: "https://example.com/two.png" } },
] }], marketplaceLoadErrors: [] };

afterEach(() => vi.useRealTimers());

describe("skill catalog plugin attribution", () => {
  it("uses exact plugin skill paths, not equal names, and preserves canonical invocation", async () => {
    const skills = await loadSkillCatalog({
      skills: async () => skillResponse,
      installedPlugins: async () => installed,
      plugin: async ({ pluginName }) => ({ plugin: { skills: [{ path: `/${pluginName}/SKILL.md` }] } }),
    });
    expect(skills[0]?.catalog).toMatchObject({ description: "Brief purpose", source: "user", pluginLink: { status: "resolved", plugin: { label: "First plugin", icon: { kind: "path", path: "/icons/one.svg" } } } });
    expect(skills[1]?.catalog?.pluginLink).toMatchObject({ plugin: { label: "Second plugin", icon: { kind: "remote", url: "https://example.com/two.png" } } });
    expect(skills[0]?.name).toBe("same");
    expect(skills[0]?.path).toBe("/one/SKILL.md");
    expect(skillPickerRows(skills, "", "all").filter((row) => row.kind === "header").map((row) => row.title)).toEqual(["First plugin", "Second plugin"]);
  });

  it("retains usable skills when optional plugin methods are unavailable", async () => {
    const skills = await loadSkillCatalog({ skills: async () => skillResponse, installedPlugins: async () => { throw new Error("Method not found"); }, plugin: async () => null });
    expect(skills).toHaveLength(3);
    expect(skills[0]?.catalog?.pluginLink).toEqual({ status: "unavailable" });
    expect(skillPickerRows(skills, "", "all").filter((row) => row.kind === "skill")).toHaveLength(2);
  });

  it("bounds decoration wait and stops scheduling plugin reads after its deadline", async () => {
    vi.useFakeTimers();
    let finishInstalled: (value: unknown) => void = () => undefined;
    const plugin = vi.fn(async () => ({ plugin: { skills: [] } }));
    const result = loadSkillCatalog({ skills: async () => skillResponse, installedPlugins: () => new Promise((resolve) => { finishInstalled = resolve; }), plugin }, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect((await result)[0]?.catalog?.pluginLink).toEqual({ status: "unavailable" });
    finishInstalled(installed);
    await vi.runAllTimersAsync();
    expect(plugin).not.toHaveBeenCalled();
  });

  it("keeps ambiguous membership unresolved rather than depending on request completion order", async () => {
    const skills = await loadSkillCatalog({ skills: async () => skillResponse, installedPlugins: async () => installed, plugin: async () => ({ plugin: { skills: [{ path: "/one/SKILL.md" }] } }) });
    expect(skills[0]?.catalog?.pluginLink).toEqual({ status: "unavailable" });
  });

  it("does not pretend unmatched skills are standalone after partial plugin failures", async () => {
    const skills = await loadSkillCatalog({ skills: async () => skillResponse, installedPlugins: async () => installed, plugin: async ({ pluginName }) => {
      if (pluginName === "two") throw new Error("Unavailable");
      return { plugin: { skills: [{ path: "/one/SKILL.md" }] } };
    } });
    expect(skills[0]?.catalog?.pluginLink.status).toBe("resolved");
    expect(skills[1]?.catalog?.pluginLink.status).toBe("unavailable");
  });

  it("rejects invalid executable metadata but tolerates missing presentation metadata", () => {
    expect(() => parseCatalogSkills({ data: [{ skills: [{ name: "broken" }] }] })).toThrow("Invalid skill metadata");
    const skills = parseCatalogSkills({ data: [{ skills: [{ name: "raw-name", path: "/raw", description: "Fallback", enabled: true, scope: "future", interface: { displayName: " ", shortDescription: "" } }] }] });
    expect(skills[0]?.catalog).toMatchObject({ title: "raw-name", description: "Fallback", source: null });
    expect(parseInstalledSkillPlugins({ marketplaces: [{ name: "m", path: null, plugins: [{ installed: true, name: "p", id: "p", interface: { logoUrl: "javascript:bad" } }] }] })[0]?.plugin.icon).toBeNull();
  });

  it("refreshes legacy metadata caches without deleting the stored skills", () => {
    const value = { models: [], skills: [{ name: "old", path: "/old", description: "Old", enabled: true }], permissions: [], defaults: { model: null, effort: null, permissions: null } };
    expect(turnControlsCacheNeedsRepair({ status: "ready", value, error: null })).toBe(true);
    expect(skillPickerRows(value.skills, "old", "all")).toHaveLength(2);
  });
});

describe("skills picker grouping and filters", () => {
  it("filters disabled entries before grouping and searching", () => {
    const skills = parseCatalogSkills(skillResponse);
    expect(skillPickerRows(skills, "hidden", "all")).toEqual([]);
    expect(skillPickerRows(skills.filter((skill) => !skill.enabled), "", "all")).toEqual([]);
  });

  it("uses source only as a filter and searches canonical names and short descriptions", () => {
    const skills = parseCatalogSkills({ data: [{ skills: [
      { ...rawSkill("canonical-name", "/p", true, "repo"), interface: { displayName: "Friendly title", shortDescription: "Preview changes" } },
      rawSkill("Personal action", "/u", true, "user"),
    ] }] });
    const rows = skillPickerRows(skills, "canonical preview", "repo");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "header", title: "Other skills", count: 1 });
    expect(rows[1]).toMatchObject({ kind: "skill", title: "Friendly title", first: true, last: true });
    expect(skillPickerRows(skills, "canonical", "user")).toEqual([]);
  });

  it("does not silently limit large enabled catalogs", () => {
    const skills = parseCatalogSkills({ data: [{ skills: Array.from({ length: 250 }, (_, index) => rawSkill(`Skill ${index}`, `/${index}`)) }] });
    expect(skillPickerRows(skills, "", "all").filter((row) => row.kind === "skill")).toHaveLength(250);
  });
});

it("limits concurrent plugin detail requests without dropping any installed plugins", async () => {
  let inFlight = 0;
  let peak = 0;
  let reads = 0;
  const result = await loadSkillCatalog({
    skills: async () => skillResponse,
    installedPlugins: async () => ({ marketplaces: [{ name: "m", path: null, plugins: Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `Plugin ${index}`, installed: true })) }] }),
    plugin: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      reads += 1;
      await Promise.resolve();
      inFlight -= 1;
      return { plugin: { skills: [] } };
    },
  });
  expect(peak).toBeLessThanOrEqual(4);
  expect(reads).toBe(20);
  expect(result[0]?.catalog?.pluginLink).toEqual({ status: "resolved", plugin: null });
});
