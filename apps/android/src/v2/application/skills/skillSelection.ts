import type { V2InputBlock, V2Skill } from "@codewide/sync-client/v2";

export type SkillCatalogEntry = V2Skill;
export type SkillInputBlock = Extract<V2InputBlock, { kind: "skill" }>;

export interface DraftSelection {
  end: number;
  start: number;
}

export interface SkillInvocationResult {
  block: SkillInputBlock;
  selection: DraftSelection;
  text: string;
}

export function insertSkillInvocation(
  text: string,
  selection: DraftSelection,
  skill: SkillCatalogEntry,
): SkillInvocationResult {
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  const invocation = `$${skill.name} `;
  const suffix = text.slice(end).replace(/^\s+/u, "");
  const nextText = `${text.slice(0, start)}${invocation}${suffix}`;
  const cursor = start + invocation.length;
  return {
    block: skillInputBlock(skill),
    selection: { end: cursor, start: cursor },
    text: nextText,
  };
}

/** Produces the generated V2 input block used by submit, steer, and queue commands. */
export function skillInputBlock(skill: SkillCatalogEntry): SkillInputBlock {
  return { kind: "skill", name: skill.name, path: skill.path };
}
