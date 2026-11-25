import type { ActionDescriptor } from "../../../data/forgeActionCatalog";

/** A standalone approval or multiple enabled verdicts get a primary button. A sole composed
 * review lives in the app bar menu. The catalog's enabled default leads in either location. */
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
  return enabled.length > 1 || lead.quickSubmit
    ? { kind: "prominent", lead, verdicts }
    : { kind: "menu", lead };
}
