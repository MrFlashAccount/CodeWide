/**
 * What one provider card offers: during a host-login flow only that flow; otherwise
 * exactly one primary connect action and the other ways in a quiet row. Unavailable
 * methods keep their reason. Pure, so the one-primary rule is testable.
 */
import type { AuthFlow, AuthMethod, ForgeProvider } from "../../../data/forgeContract";
import { accountMethods } from "./providerPresentation";

/** One connect action derived from a method; `link` carries the host login to link. */
export type ConnectAction =
  | { readonly kind: "link"; readonly login: string; readonly method: AuthMethod }
  | { readonly kind: "hostLogin" | "instructions" | "pasteToken"; readonly method: AuthMethod };

/** The card's content. */
export type CardPlan =
  | { readonly flow: AuthFlow; readonly kind: "flow" }
  | {
      readonly kind: "methods";
      readonly others: readonly ConnectAction[];
      readonly primary: ConnectAction | null;
      readonly unavailable: readonly AuthMethod[];
    };

/** A checks credential is separate from the account login, so no login is excluded there. */
const NO_LINKED_LOGINS: ReadonlySet<string> = new Set();

/** A login already linked on this connection is never offered again as "Link @login". */
function actionsOf(
  method: AuthMethod,
  linkedLogins: ReadonlySet<string>,
): readonly ConnectAction[] {
  if (method.kind === "linkExisting") {
    return method.existingLogins
      .filter((login) => !linkedLogins.has(login))
      .map((login) => ({ kind: "link", login, method }));
  }
  return [{ kind: method.kind, method }];
}

/** Host steps are what the user does when nothing else is available, so they stay actionable. */
function offered(method: AuthMethod): boolean {
  return method.available || method.kind === "instructions";
}

/**
 * Builds the card plan from the provider's account methods, its live flow and
 * the logins already linked for the provider's host.
 */
export function cardPlan(
  provider: ForgeProvider,
  flow: AuthFlow | null,
  linkedLogins: ReadonlySet<string>,
): CardPlan {
  if (flow !== null) {
    return { flow, kind: "flow" };
  }
  return methodsPlan(provider, linkedLogins);
}

/** Method-selection plan when navigation owns the live-flow step separately. */
export function methodsPlan(
  provider: ForgeProvider,
  linkedLogins: ReadonlySet<string>,
): Extract<CardPlan, { readonly kind: "methods" }> {
  const methods = accountMethods(provider);
  const actions = methods.filter(offered).flatMap((method) => actionsOf(method, linkedLogins));
  const [primary = null, ...others] = actions;
  return {
    kind: "methods",
    others,
    primary,
    unavailable: methods.filter((method) => !offered(method)),
  };
}

/** Stable identity of one connect action on a card (a link carries its login). */
export function connectActionKey(action: ConnectAction): string {
  return action.kind === "link"
    ? `${action.method.methodId}:${action.login}`
    : action.method.methodId;
}

/** Label of a quiet secondary action; the primary keeps the plugin label. */
export function otherActionLabel(action: ConnectAction): string {
  return action.kind === "link" ? `Link @${action.login}` : action.method.label;
}

/** Connect actions of the optional checks credential (for example an Arc CI token). */
export function checksActions(provider: ForgeProvider): readonly ConnectAction[] {
  return provider.authMethods
    .filter((method) => method.purpose === "checks" && offered(method))
    .flatMap((method) => actionsOf(method, NO_LINKED_LOGINS));
}
