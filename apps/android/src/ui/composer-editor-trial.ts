import type { ComposerMention } from "./composer-mentions";
import type { MentionQuery } from "./composer-suggestions";

// These are visibly labelled demo entities, never server context or real skills.
const skills: readonly ComposerMention[] = [
  { kind: "skill", id: "demo-review", label: "Review", insertText: "$review", name: "review", path: "/demo/review", url: "codewide-skill://%2Fdemo%2Freview", description: "Demo skill: review code. Nothing is executed.", group: "Demo plugin", plugin: null },
  { kind: "skill", id: "demo-tests", label: "Tests", insertText: "$tests", name: "tests", path: "/demo/tests", url: "codewide-skill://%2Fdemo%2Ftests", description: "Demo skill: check tests. Nothing is executed.", group: "Demo plugin", plugin: null },
];
const context: readonly ComposerMention[] = [
  { kind: "thread", id: "demo-file", label: "README.md", insertText: "@README.md", threadId: "demo-file", url: "thread://demo-file", description: "Example file, not read from your server.", group: "Demo files" },
  { kind: "thread", id: "demo-thread", label: "Composer discussion", insertText: "@Composer discussion", threadId: "demo-thread", url: "thread://demo-thread", description: "Example conversation, not a real thread.", group: "Demo chats" },
];

export async function searchComposerTrialMentions(query: MentionQuery): Promise<readonly ComposerMention[]> {
  const entries = query.indicator === "/" ? skills : context;
  const text = query.text.trim().toLowerCase();
  if (text === "") return entries;
  return entries.filter((entry) => entry.label.toLowerCase().includes(text));
}
