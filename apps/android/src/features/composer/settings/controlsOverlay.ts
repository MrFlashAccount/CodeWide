/**
 * Local optimistic overlay of an existing thread's execution settings.
 *
 * The thread's server settings (the `thread/settings/updated` echo or a fresh
 * snapshot) are the authority. A local choice is shown only while the server
 * still reports the value it was shown over (`baseline`); the echo of the
 * choice confirms it, and any other server change — from another device, or
 * a later revert — replaces it. A rejected command removes its entries, so
 * the chip reverts. A confirmed entry remains only to say that a choice made
 * during a running turn applies from the next turn.
 */

import type { ProjectedThreadExecutionSettings } from "@codewide/sync-client";
import type { ThreadSettings } from "../../../data/turn-controls-types";

/** Execution fields the composer changes through `thread/settings/update`. */
export type ComposerControlField = "effort" | "model" | "permissions" | "serviceTier";

/** One locally chosen value awaiting or past server acknowledgement. */
export type ComposerControlEntry = {
  /**
   * The server value this entry is shown over: the value when the choice was
   * made, then the chosen value once the server echoed it.
   */
  readonly baseline: string | null;
  /** Server value when the choice was made. */
  readonly from: string | null;
  /** Ownership token: a later choice of the same field replaces this one. */
  readonly mutation: number;
  /** `sending`: queued or in flight; `accepted`: the server answered the command. */
  readonly status: "accepted" | "sending";
  /** The turn that was running when the choice was made; `null` when idle. */
  readonly turnId: string | null;
  readonly value: string | null;
};

/** The overlay of one conversation activation. */
export type ComposerControlsOverlay = Readonly<
  Record<ComposerControlField, ComposerControlEntry | null>
>;

/** No local choice. */
export const EMPTY_CONTROLS_OVERLAY: ComposerControlsOverlay = {
  effort: null,
  model: null,
  permissions: null,
  serviceTier: null,
};

/** Values chosen together and sent in one `thread/settings/update`. */
export type ComposerControlChanges = Readonly<Partial<Record<ComposerControlField, string | null>>>;

/** What the owner knew about the thread when the choice was made. */
export type ComposerControlBaseline = {
  readonly activeTurnId: string | null;
  readonly server: Readonly<Record<ComposerControlField, string | null>>;
};

/** One local choice: the values sent together and what the owner knew when sending. */
export type ComposerControlMutation = {
  readonly baseline: ComposerControlBaseline;
  readonly changes: ComposerControlChanges;
  /** Ownership token of this choice. */
  readonly mutation: number;
};

/** Records `changes` as one `sending` mutation. */
export function overlayWithChanges(
  overlay: ComposerControlsOverlay,
  { baseline, changes, mutation }: ComposerControlMutation,
): ComposerControlsOverlay {
  const entry = (field: ComposerControlField): ComposerControlEntry | null => {
    const value = changes[field];
    return value === undefined
      ? overlay[field]
      : {
          baseline: baseline.server[field],
          from: baseline.server[field],
          mutation,
          status: "sending",
          turnId: baseline.activeTurnId,
          value,
        };
  };
  return {
    effort: entry("effort"),
    model: entry("model"),
    permissions: entry("permissions"),
    serviceTier: entry("serviceTier"),
  };
}

/** Marks the entries `mutation` still owns as accepted by the server. */
export function overlayAccepted(
  overlay: ComposerControlsOverlay,
  mutation: number,
): ComposerControlsOverlay {
  const entry = (current: ComposerControlEntry | null): ComposerControlEntry | null =>
    current?.mutation === mutation ? { ...current, status: "accepted" } : current;
  return {
    effort: entry(overlay.effort),
    model: entry(overlay.model),
    permissions: entry(overlay.permissions),
    serviceTier: entry(overlay.serviceTier),
  };
}

/** Drops the entries `mutation` still owns: the server rejected them. */
export function overlayRejected(
  overlay: ComposerControlsOverlay,
  mutation: number,
): ComposerControlsOverlay {
  const entry = (current: ComposerControlEntry | null): ComposerControlEntry | null =>
    current?.mutation === mutation ? null : current;
  return {
    effort: entry(overlay.effort),
    model: entry(overlay.model),
    permissions: entry(overlay.permissions),
    serviceTier: entry(overlay.serviceTier),
  };
}

/** Whether `overlay` still holds an entry of `mutation`. */
export function overlayOwnsMutation(overlay: ComposerControlsOverlay, mutation: number): boolean {
  return (
    overlay.effort?.mutation === mutation ||
    overlay.model?.mutation === mutation ||
    overlay.permissions?.mutation === mutation ||
    overlay.serviceTier?.mutation === mutation
  );
}

/** The server value of `field`, `null` when the server reports none. */
export function serverControlValue(
  server: ProjectedThreadExecutionSettings | null,
  field: ComposerControlField,
): string | null {
  if (server === null) {
    return null;
  }
  return field === "model"
    ? server.model
    : field === "effort"
      ? server.effort
      : field === "permissions"
        ? server.permissions
        : (server.serviceTier ?? null);
}

/** The server values a new local choice is compared against. */
export function controlBaseline(
  server: ProjectedThreadExecutionSettings | null,
  activeTurnId: string | null,
): ComposerControlBaseline {
  return {
    activeTurnId,
    server: {
      effort: serverControlValue(server, "effort"),
      model: serverControlValue(server, "model"),
      permissions: serverControlValue(server, "permissions"),
      serviceTier: serverControlValue(server, "serviceTier"),
    },
  };
}

/**
 * The local entry still in effect over the server value: while the server
 * reports the value the entry is shown over, or the entry's own value (its
 * echo, which confirms it). Any other server value is authoritative.
 */
export function shownOverlayEntry(
  entry: ComposerControlEntry | null,
  server: ProjectedThreadExecutionSettings | null,
  field: ComposerControlField,
): ComposerControlEntry | null {
  if (entry === null) {
    return null;
  }
  const value = serverControlValue(server, field);
  if (value === entry.baseline) {
    return entry;
  }
  return value === entry.value ? { ...entry, baseline: value } : null;
}

/**
 * Confirms entries the server echoed and drops entries whose field the server
 * changed to another value.
 */
function overlayAfterServerChange(
  overlay: ComposerControlsOverlay,
  server: ProjectedThreadExecutionSettings | null,
): ComposerControlsOverlay {
  const effort = shownOverlayEntry(overlay.effort, server, "effort");
  const model = shownOverlayEntry(overlay.model, server, "model");
  const permissions = shownOverlayEntry(overlay.permissions, server, "permissions");
  const serviceTier = shownOverlayEntry(overlay.serviceTier, server, "serviceTier");
  return effort === overlay.effort &&
    model === overlay.model &&
    permissions === overlay.permissions &&
    serviceTier === overlay.serviceTier
    ? overlay
    : { effort, model, permissions, serviceTier };
}

/** The settings owner's state: what the composer knows of the thread's settings. */
export type ComposerControlsState = {
  /** The thread's running turn when `server` was observed. */
  readonly activeTurnId: string | null;
  readonly overlay: ComposerControlsOverlay;
  /** The thread's server settings as last observed by the composer. */
  readonly server: ProjectedThreadExecutionSettings | null;
};

function sameServerSettings(
  left: ProjectedThreadExecutionSettings | null,
  right: ProjectedThreadExecutionSettings | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.model === right.model &&
    left.effort === right.effort &&
    left.permissions === right.permissions &&
    left.serviceTier === right.serviceTier &&
    left.approvalPolicy === right.approvalPolicy &&
    left.sandboxPolicy === right.sandboxPolicy
  );
}

/** Records a newly observed server state; returns `state` itself when nothing changed. */
export function reconcileControlsState(
  state: ComposerControlsState,
  server: ProjectedThreadExecutionSettings | null,
  activeTurnId: string | null,
): ComposerControlsState {
  const overlay = overlayAfterServerChange(state.overlay, server);
  if (
    overlay === state.overlay &&
    activeTurnId === state.activeTurnId &&
    sameServerSettings(state.server, server)
  ) {
    return state;
  }
  return { activeTurnId, overlay, server };
}

/** The `thread/settings/update` fields of `changes`. */
export function threadSettingsUpdate(changes: ComposerControlChanges): ThreadSettings {
  return {
    ...(changes.effort === undefined ? {} : { effort: changes.effort }),
    ...(changes.model === undefined ? {} : { model: changes.model }),
    ...(changes.permissions === undefined ? {} : { permissions: changes.permissions }),
    ...(changes.serviceTier === undefined ? {} : { serviceTier: changes.serviceTier }),
  };
}
