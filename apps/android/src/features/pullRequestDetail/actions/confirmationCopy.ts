import type { ActionDescriptor, ActionKind } from "../../../data/forgeActionCatalog";

/** Dialog copy: a question title, one consequence line and the action label. */
export type ConfirmationCopy = {
  readonly confirmLabel: string;
  readonly consequence: string;
  readonly title: string;
};

type CopyInput = {
  readonly action: ActionDescriptor;
  readonly host: string;
  readonly method: string;
};

const KNOWN_COPY: Partial<Readonly<Record<ActionKind, (input: CopyInput) => ConfirmationCopy>>> = {
  autoMerge: ({ action, host }) =>
    action.toggle?.on === true
      ? {
          confirmLabel: "Turn off",
          consequence: `${host} will no longer merge this pull request automatically.`,
          title: "Turn off auto-merge?",
        }
      : {
          confirmLabel: "Turn on",
          consequence: `${host} merges this pull request once required checks pass.`,
          title: "Turn on auto-merge?",
        },
  close: ({ action, host }) => ({
    confirmLabel: "Close",
    consequence: `Closes it on ${host} without merging. Linked threads stay open.`,
    title: `${action.label}?`,
  }),
  merge: ({ host, method }) => ({
    confirmLabel: "Merge",
    consequence: `${method} on ${host}. CodeWide cannot undo this.`,
    title: `${method}?`,
  }),
  updateBranch: ({ action, host }) => ({
    confirmLabel: action.label,
    consequence: `Merges the base branch into this pull request on ${host}.`,
    title: `${action.label}?`,
  }),
};

/**
 * Copy of the confirmation dialog. Every consequence names the forge host it
 * writes to (N-08); known kinds say what is written; other kinds repeat their
 * plugin label. CodeWide cannot undo a forge write.
 */
export function confirmationCopy(
  action: ActionDescriptor,
  input: boolean | string | null,
  host: string,
): ConfirmationCopy {
  const method =
    typeof input === "string" && action.input?.type === "enum"
      ? (action.input.options.find((option) => option.value === input)?.label ?? action.label)
      : action.label;
  const known = KNOWN_COPY[action.kind];
  return known === undefined
    ? {
        confirmLabel: action.label,
        consequence: `Runs on ${host}.`,
        title: `${action.label}?`,
      }
    : known({ action, host, method });
}
