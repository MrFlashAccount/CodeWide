import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type Turn = Thread["turns"][number];

const ENVIRONMENT_CONTEXT_MARKERS = ["<environment_context>", "</environment_context>"] as const;

const visibleTurnCache = new WeakMap<Turn, Turn>();

/**
 * Mirrors Codex's ResponseItem -> TurnItem projection for environment context:
 * model-only user-role context is not a user-authored chat message.
 */
export function projectCodexVisibleTurn(turn: Turn): Turn {
  const cached = visibleTurnCache.get(turn);
  if (cached !== undefined) return cached;

  const items = turn.items.filter((item) => !(
    item.type === "userMessage"
    && item.content.some((part) => part.type === "text" && isCodexEnvironmentContext(part.text))
  ));
  const projected = items.length === turn.items.length ? turn : { ...turn, items };
  visibleTurnCache.set(turn, projected);
  return projected;
}

export function isCodexEnvironmentContext(value: string): boolean {
  const text = value.trim();
  const [open, close] = ENVIRONMENT_CONTEXT_MARKERS;
  return startsWithAsciiCaseInsensitive(text, open) && endsWithAsciiCaseInsensitive(text, close);
}

function startsWithAsciiCaseInsensitive(value: string, prefix: string): boolean {
  return value.slice(0, prefix.length).toLowerCase() === prefix;
}

function endsWithAsciiCaseInsensitive(value: string, suffix: string): boolean {
  return value.slice(Math.max(0, value.length - suffix.length)).toLowerCase() === suffix;
}
