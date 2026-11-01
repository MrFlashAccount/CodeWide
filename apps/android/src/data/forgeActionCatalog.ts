/**
 * Plugin-declared PR action catalog. Wire values Android does not know are
 * parsed exactly as the contract states and never guessed:
 * - unknown kind → `extension`;
 * - unknown placement → `overflow`; unknown anchor → `null` with `overflow` placement;
 * - unknown confirm level, unknown input type, or `disabled` without a reason → dropped.
 * Dropped descriptors are reported by their opaque `actionId` only.
 */
import { headRevision, type HeadRevision } from "./forgeContract";
import {
  count,
  decodeOrNull,
  flag,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
} from "./forgeWire";
import { unknownRecord } from "./unknownRecord";

const KNOWN_KINDS = [
  "verdict",
  "merge",
  "autoMerge",
  "updateBranch",
  "close",
  "fixCi",
  "rebase",
  "addressComments",
  "reviewPr",
  "extension",
] as const;

/** Descriptor kind; unknown wire kinds become `extension`. */
export type ActionKind = (typeof KNOWN_KINDS)[number];
/** Confirmation level, ordered none < confirm < destructive. */
export type ConfirmLevel = "confirm" | "destructive" | "none";
/** Where the plugin asks for the action; it never changes the confirmation. */
type ActionPlacement = "overflow" | "primary" | "secondary";

/** Anchor that places an action next to the problem it fixes. */
export type ActionAnchor =
  | { readonly kind: "header" }
  | { readonly checkId: string; readonly kind: "checks" }
  | { readonly kind: "conflict" }
  | { readonly kind: "reviewThread"; readonly reviewThreadId: string }
  | { readonly kind: "file"; readonly path: string };

/** Input an action collects before it runs. */
export type ActionInput =
  | { readonly label: string; readonly placeholder: string | null; readonly type: "text" }
  | {
      readonly label: string;
      readonly options: readonly { readonly label: string; readonly value: string }[];
      readonly type: "enum";
    }
  | { readonly label: string; readonly type: "boolean" };

/** One validated catalog action. */
export type ActionDescriptor = {
  readonly actionId: string;
  readonly anchor: ActionAnchor | null;
  readonly availability:
    | { readonly state: "enabled" }
    | { readonly reason: string; readonly state: "disabled" };
  readonly confirm: ConfirmLevel;
  readonly group: string;
  readonly input: ActionInput | null;
  readonly isDefault: boolean;
  readonly kind: ActionKind;
  readonly label: string;
  readonly order: number;
  readonly placement: ActionPlacement;
  readonly toggle: { readonly on: boolean } | null;
};

/** The catalog is valid for exactly one head revision. */
export type ActionCatalog = {
  readonly actions: readonly ActionDescriptor[];
  readonly headRevision: HeadRevision;
};

/** Receives the opaque id of every dropped descriptor. */
export type DroppedActionReporter = (actionId: string) => void;

/** `undefined` marks an anchor kind this client does not know; it forces overflow placement. */
function anchor(value: unknown): ActionAnchor | null | undefined {
  const entry = unknownRecord(value);
  if (entry === null) {
    return null;
  }
  switch (entry.kind) {
    case "header":
    case "conflict": {
      return { kind: entry.kind };
    }
    case "checks": {
      return typeof entry.checkId === "string"
        ? { checkId: entry.checkId, kind: "checks" }
        : undefined;
    }
    case "reviewThread": {
      return typeof entry.reviewThreadId === "string"
        ? { kind: "reviewThread", reviewThreadId: entry.reviewThreadId }
        : undefined;
    }
    case "file": {
      return typeof entry.path === "string" ? { kind: "file", path: entry.path } : undefined;
    }
    default: {
      return undefined;
    }
  }
}

function enumOptions(
  value: unknown,
  path: string,
): { readonly label: string; readonly value: string }[] {
  return list(value, path, (option, optionPath) => {
    const item = record(option, optionPath);
    return {
      label: text(item.label, `${optionPath}.label`),
      value: nonEmptyText(item.value, `${optionPath}.value`),
    };
  });
}

/** Decodes the declared input; `undefined` means a type this client does not know (dropped). */
function input(value: unknown, path: string): ActionInput | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const entry = record(value, path);
  const label = text(entry.label, `${path}.label`);
  switch (entry.type) {
    case "text": {
      return {
        label,
        placeholder: optionalText(entry.placeholder ?? null, `${path}.placeholder`),
        type: "text",
      };
    }
    case "boolean": {
      return { label, type: "boolean" };
    }
    case "enum": {
      return { label, options: enumOptions(entry.options, `${path}.options`), type: "enum" };
    }
    default: {
      return undefined;
    }
  }
}

function confirmLevel(value: unknown): ConfirmLevel | null {
  return value === "none" || value === "confirm" || value === "destructive" ? value : null;
}

/** Enabled, disabled with a reason, or `null` for a disabled action without one (dropped). */
function availability(value: unknown, path: string): ActionDescriptor["availability"] | null {
  const entry = record(value, path);
  if (entry.state !== "disabled") {
    return { state: oneOf(entry.state, ["enabled"], `${path}.state`) };
  }
  return typeof entry.reason === "string" && entry.reason.length > 0
    ? { reason: entry.reason, state: "disabled" }
    : null;
}

function placement(value: unknown, anchorKnown: boolean): ActionPlacement {
  return anchorKnown && (value === "primary" || value === "secondary") ? value : "overflow";
}

function toggle(value: unknown, path: string): { readonly on: boolean } | null {
  return value === null || value === undefined
    ? null
    : { on: flag(record(value, path).on, `${path}.on`) };
}

/** Decodes one descriptor, or returns `null` when the contract says to drop it. */
function descriptor(value: unknown, path: string): ActionDescriptor | null {
  const entry = record(value, path);
  const confirm = confirmLevel(entry.confirm);
  const state = availability(entry.availability, `${path}.availability`);
  const declaredInput = input(entry.input, `${path}.input`);
  if (confirm === null || state === null || declaredInput === undefined) {
    return null;
  }
  const parsedAnchor = anchor(entry.anchor);
  return {
    actionId: nonEmptyText(entry.actionId, `${path}.actionId`),
    anchor: parsedAnchor ?? null,
    availability: state,
    confirm,
    group: text(entry.group, `${path}.group`),
    input: declaredInput,
    isDefault: flag(entry.isDefault, `${path}.isDefault`),
    kind: KNOWN_KINDS.find((kind) => kind === entry.kind) ?? "extension",
    label: nonEmptyText(entry.label, `${path}.label`),
    order: count(entry.order, `${path}.order`),
    placement: placement(entry.placement, parsedAnchor !== undefined),
    toggle: toggle(entry.toggle, `${path}.toggle`),
  };
}

/** Decodes a catalog, dropping only the descriptors the contract says to drop. */
export function actionCatalog(
  value: unknown,
  path: string,
  reportDropped: DroppedActionReporter,
): ActionCatalog {
  const catalog = record(value, path);
  const actions: ActionDescriptor[] = [];
  list(catalog.actions, `${path}.actions`, (item, itemPath) => {
    const action = descriptor(item, itemPath);
    if (action === null) {
      const id = unknownRecord(item)?.actionId;
      reportDropped(typeof id === "string" ? id : "unknown");
    } else {
      actions.push(action);
    }
  });
  return { actions, headRevision: headRevision(catalog.headRevision, `${path}.headRevision`) };
}

/** Parses a standalone catalog (for example `staleHead` error data). */
export function parseActionCatalog(
  value: unknown,
  reportDropped: DroppedActionReporter,
): ActionCatalog | null {
  return decodeOrNull(() => actionCatalog(value, "catalog", reportDropped));
}
