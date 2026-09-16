import type { ComposerMention } from "./composer-mentions";
import type { MentionQuery } from "./composer-suggestions";

// These are visibly labelled demo entities, never server context or real skills.
const skills: readonly ComposerMention[] = [
  {
    description: "Demo skill: review code. Nothing is executed.",
    group: "Demo plugin",
    id: "demo-review",
    insertText: "$review",
    kind: "skill",
    label: "Review",
    name: "review",
    path: "/demo/review",
    plugin: null,
    url: "codewide-skill://%2Fdemo%2Freview",
  },
  {
    description: "Demo skill: check tests. Nothing is executed.",
    group: "Demo plugin",
    id: "demo-tests",
    insertText: "$tests",
    kind: "skill",
    label: "Tests",
    name: "tests",
    path: "/demo/tests",
    plugin: null,
    url: "codewide-skill://%2Fdemo%2Ftests",
  },
];
const context: readonly ComposerMention[] = [
  {
    description: "Example file, not read from your server.",
    group: "Demo files",
    id: "demo-file",
    insertText: "@README.md",
    kind: "thread",
    label: "README.md",
    threadId: "demo-file",
    url: "thread://demo-file",
  },
  {
    description: "Example conversation, not a real thread.",
    group: "Demo chats",
    id: "demo-thread",
    insertText: "@Composer discussion",
    kind: "thread",
    label: "Composer discussion",
    threadId: "demo-thread",
    url: "thread://demo-thread",
  },
];

export async function searchComposerTrialMentions(
  query: MentionQuery,
): Promise<readonly ComposerMention[]> {
  await Promise.resolve();
  const entries = query.indicator === "/" ? skills : context;
  const text = query.text.trim().toLowerCase();
  if (text === "") {
    return entries;
  }
  return entries.filter((entry) => entry.label.toLowerCase().includes(text));
}
