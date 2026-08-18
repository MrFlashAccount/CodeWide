import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

export function transcriptionLanguageHint(thread: Thread | null | undefined): "ru" | "en" | null {
  if (thread === null || thread === undefined) return null;
  let cyrillic = 0;
  let latin = 0;
  let userMessages = 0;
  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0 && userMessages < 6; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (turn === undefined) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0 && userMessages < 6; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (item?.type !== "userMessage") continue;
      const text = item.content.flatMap((part) => part.type === "text" ? [part.text.slice(0, 2_000)] : []).join(" ");
      cyrillic += text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
      latin += text.match(/[A-Za-z]/g)?.length ?? 0;
      userMessages += 1;
    }
  }
  // Technical Russian naturally contains many Latin identifiers. Require a
  // useful Cyrillic sample, but do not make it outnumber every code token.
  if (cyrillic >= 12 && cyrillic * 3 >= latin) return "ru";
  if (latin >= 12 && latin >= cyrillic * 3) return "en";
  return null;
}
