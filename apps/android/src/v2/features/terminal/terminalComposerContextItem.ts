import type { TerminalContextSnapshot } from "../../domain/terminalSession";
import type { ComposerContextItem } from "../../presentation/input/ComposerContextStripView";

/** Builds the conversation chip for runtime-owned terminal tabs. */
export function terminalComposerContextItem(
  context: TerminalContextSnapshot,
): ComposerContextItem | null {
  if (context.sessionCount === 0) return null;
  return {
    icon: "terminal",
    id: "terminal",
    label: `Terminals: ${context.sessionCount}`,
  };
}
