import type { SkillPlugin } from "../../../data/skill-catalog-types";

type ComposerMentionBase = {
  readonly description: string;
  readonly group: string;
  readonly id: string;
  readonly insertText: string;
  readonly label: string;
  readonly url: string;
};

/** A selected row carries the validated target needed by the sending owner. */
export type ComposerMention =
  | (ComposerMentionBase & {
      readonly kind: "skill";
      readonly name: string;
      readonly path: string;
      readonly plugin: SkillPlugin | null;
    })
  | (ComposerMentionBase & { readonly kind: "thread"; readonly threadId: string });
