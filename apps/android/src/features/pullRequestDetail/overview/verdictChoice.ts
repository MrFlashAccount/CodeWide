import type { ActionDescriptor } from "../../../data/forgeActionCatalog";

/**
 * How Details offers the plugin's verdict group, decided only by availability (never by plugin id
 * or forge name):
 * - `prominent`: the viewer has a real choice (at least two enabled verdicts), so a split button
 *   leads with `lead` (the group default when it is enabled, else the first enabled verdict) and
 *   lists every verdict in its menu;
 * - `menu`: one verdict is enabled (for example only Comment on the author's own PR), so nothing
 *   prominent is shown and the app bar menu offers Submit review with it;
 * - `none`: no verdict can be submitted.
 * Every choice opens the Submit review sheet; none publishes a verdict by itself.
 */
export type VerdictChoice =
  | {
      readonly kind: "prominent";
      readonly lead: ActionDescriptor;
      readonly verdicts: readonly ActionDescriptor[];
    }
  | { readonly kind: "menu"; readonly lead: ActionDescriptor }
  | { readonly kind: "none" };

/** Chooses the Details verdict offer from the slotted verdicts, the group default first. */
export function verdictChoice(verdicts: readonly ActionDescriptor[]): VerdictChoice {
  const enabled = verdicts.filter((verdict) => verdict.availability.state === "enabled");
  const [lead] = enabled;
  if (lead === undefined) {
    return { kind: "none" };
  }
  return enabled.length > 1 ? { kind: "prominent", lead, verdicts } : { kind: "menu", lead };
}
