import type { CatalogSkill } from "../../../data/skill-catalog-types";
import { skillPickerRows } from "../../../ui/skill-picker-model";
import type { ComposerMention } from "../input/composer-mentions";

const skillUrlPrefix = "codewide-skill://";

export function composerSkillUrl(path: string): string {
  return `${skillUrlPrefix}${encodeURIComponent(path)}`;
}

export function composerSkillSuggestions(
  skills: readonly CatalogSkill[],
  query: string,
): ComposerMention[] {
  return skillPickerRows(skills, query, "all").flatMap((row) => {
    if (row.kind === "header") return [];
    const link = row.skill.catalog?.pluginLink;
    const plugin = link?.status === "resolved" ? link.plugin : null;
    return [
      {
        kind: "skill" as const,
        id: `skill:${row.skill.path}`,
        label: suggestionLabel(row.skill, row.title, plugin !== null),
        insertText: `$${row.skill.name}`,
        url: composerSkillUrl(row.skill.path),
        description: row.description,
        group:
          plugin?.label ?? (link?.status === "resolved" ? "Standalone skills" : "Other skills"),
        name: row.skill.name,
        path: row.skill.path,
        plugin,
      },
    ];
  });
}

function suggestionLabel(skill: CatalogSkill, title: string, hasPlugin: boolean): string {
  if (!hasPlugin) return title;
  const separator = skill.name.indexOf(":");
  if (separator < 0) return title;
  const prefix = skill.name.slice(0, separator + 1);
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/** Composer-only links carry atomic editing metadata; the app-server receives plain `$skill`. */
export function markdownForComposerSubmission(markdown: string): string {
  return markdown.replace(
    /\[([^\]\r\n]+)\]\(codewide-skill:\/\/[^)\r\n]*\)/gu,
    (_match, label: string) => label.replaceAll("\\]", "]").replaceAll("\\\\", "\\"),
  );
}

export function containsSkillInvocation(text: string, skillName: string): boolean {
  const token = `$${skillName}`;
  let offset = text.indexOf(token);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (text[offset - 1] ?? "");
    const after = text[offset + token.length] ?? "";
    if (!/[\p{L}\p{N}_-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) return true;
    offset = text.indexOf(token, offset + token.length);
  }
  return false;
}
