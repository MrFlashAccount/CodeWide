import { describe, expect, it } from "vitest";

import type { CatalogSkill } from "../src/data/skill-catalog-types";
import {
  composerSkillSuggestions,
  containsSkillInvocation,
  markdownForComposerSubmission,
} from "../src/ui/composer-skill-suggestions";

const skills: CatalogSkill[] = [
  {
    name: "quality:review",
    path: "/skills/review",
    description: "Review code",
    enabled: true,
    catalog: {
      title: "quality:review",
      description: "Stress-test a change",
      source: "user",
      pluginLink: { status: "resolved", plugin: { id: "quality", label: "Quality", icon: null } },
    },
  },
  { name: "disabled", path: "/skills/disabled", description: "Hidden", enabled: false },
];

describe("composer skill suggestions", () => {
  it("maps enabled catalog results to canonical dollar invocations", () => {
    expect(composerSkillSuggestions(skills, "review")).toEqual([{
      kind: "skill",
      id: "skill:/skills/review",
      label: "review",
      insertText: "$quality:review",
      url: "codewide-skill://%2Fskills%2Freview",
      description: "Stress-test a change",
      group: "Quality",
      name: "quality:review",
      path: "/skills/review",
      plugin: { id: "quality", label: "Quality", icon: null },
    }]);
    expect(composerSkillSuggestions(skills, "disabled")).toEqual([]);
  });

  it("removes composer metadata links before submission", () => {
    expect(markdownForComposerSubmission("Use [$review](codewide-skill://%2Fskills%2Freview) now"))
      .toBe("Use $review now");
  });

  it("matches only complete skill invocation tokens", () => {
    expect(containsSkillInvocation("Use $review now", "review")).toBe(true);
    expect(containsSkillInvocation("$review\nthen continue", "review")).toBe(true);
    expect(containsSkillInvocation("Use $reviewer", "review")).toBe(false);
    expect(containsSkillInvocation("prefix$review", "review")).toBe(false);
  });
});
