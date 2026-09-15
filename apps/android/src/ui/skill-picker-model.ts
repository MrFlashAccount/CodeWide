import type { CatalogSkill, SkillPlugin, SkillSource } from "../data/skill-catalog-types";

export type SkillFilter = "all" | SkillSource | "unknown";
export const skillFilters: readonly { id: SkillFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "repo", label: "Project" },
  { id: "user", label: "Personal" },
  { id: "system", label: "Built-in" },
  { id: "admin", label: "Admin" },
  { id: "unknown", label: "Unknown source" },
];

export type SkillPickerRowModel =
  | { kind: "header"; key: string; title: string; plugin: SkillPlugin | null; count: number }
  | {
      kind: "skill";
      key: string;
      skill: CatalogSkill;
      title: string;
      description: string;
      first: boolean;
      last: boolean;
    };

/** Filter before grouping so disabled skills never leak through search, headings or counts. */
export function skillPickerRows(
  skills: readonly CatalogSkill[],
  query: string,
  filter: SkillFilter,
): SkillPickerRowModel[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const groups = new Map<
    string,
    { title: string; plugin: SkillPlugin | null; skills: CatalogSkill[] }
  >();
  const seen = new Set<string>();
  for (const skill of skills) {
    if (!skill.enabled || seen.has(skill.path)) continue;
    seen.add(skill.path);
    if (filter !== "all" && filter !== (skill.catalog?.source ?? "unknown")) continue;
    const link = skill.catalog?.pluginLink;
    const plugin = link?.status === "resolved" ? link.plugin : null;
    const haystack =
      `${skill.name}\n${skill.catalog?.title ?? ""}\n${skill.description}\n${skill.catalog?.description ?? ""}\n${plugin?.label ?? ""}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const id =
      plugin === null
        ? link?.status === "resolved"
          ? "standalone"
          : "unresolved"
        : `plugin:${plugin.id}`;
    let group = groups.get(id);
    if (group === undefined) {
      group = {
        title:
          plugin?.label ?? (link?.status === "resolved" ? "Standalone skills" : "Other skills"),
        plugin,
        skills: [],
      };
      groups.set(id, group);
    }
    group.skills.push(skill);
  }
  const rows: SkillPickerRowModel[] = [];
  for (const [id, group] of [...groups].sort(([, left], [, right]) => {
    if (left.plugin === null && right.plugin !== null) return 1;
    if (left.plugin !== null && right.plugin === null) return -1;
    return left.title.localeCompare(right.title);
  })) {
    rows.push({
      kind: "header",
      key: `header:${id}`,
      title: group.title,
      plugin: group.plugin,
      count: group.skills.length,
    });
    group.skills.sort(
      (left, right) =>
        (left.catalog?.title ?? left.name).localeCompare(right.catalog?.title ?? right.name) ||
        left.path.localeCompare(right.path),
    );
    group.skills.forEach((skill, index) => {
      rows.push({
        kind: "skill",
        key: `skill:${skill.path}`,
        skill,
        title: skill.catalog?.title ?? skill.name,
        description: skill.catalog?.description ?? skill.description,
        first: index === 0,
        last: index === group.skills.length - 1,
      });
    });
  }
  return rows;
}
