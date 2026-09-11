import type { SkillPlugin } from "../data/skill-catalog-types";

type ComposerMentionBase = {
  readonly id: string;
  readonly label: string;
  readonly insertText: string;
  readonly url: string;
  readonly description: string;
  readonly group: string;
};

/** A selected row carries the validated target needed by the sending owner. */
export type ComposerMention =
  | (ComposerMentionBase & { readonly kind: "skill"; readonly name: string; readonly path: string; readonly plugin: SkillPlugin | null })
  | (ComposerMentionBase & { readonly kind: "thread"; readonly threadId: string });
