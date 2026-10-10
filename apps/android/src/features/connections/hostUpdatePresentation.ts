import type { HostUpdatePlatform } from "./hostUpdateContract";
import type { HostUpdateView } from "./hostUpdateSettingsContract";

/** Software whose remote update one settings row presents. */
export type HostUpdateSubject = "Companion" | "Relay";

/** One-line state shown under the version; never replaces the version itself. */
export type HostUpdateSummary = {
  readonly text: string;
  readonly tone: "error" | "muted" | "success";
};

/** Explanation shown below the row when the state needs one: progress, setup or a failure. */
export type HostUpdateGuidance =
  | { readonly kind: "progress"; readonly text: string }
  | { readonly command: string | null; readonly kind: "setup"; readonly text: string }
  | { readonly kind: "failure"; readonly text: string };

const INSTALLER_BASE_URL = "https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install";

/** Short state for the row description, prefixed by the platform when it is known. */
export function hostUpdateDescription(update: HostUpdateView): HostUpdateSummary {
  const summary = hostUpdateSummary(update);
  return update.platform === null
    ? { text: capitalized(summary.text), tone: summary.tone }
    : { text: `${platformLabel(update.platform)} · ${summary.text}`, tone: summary.tone };
}

/** The explanation below the row, or `null` when the summary says everything. */
export function hostUpdateGuidance(
  update: HostUpdateView,
  subject: HostUpdateSubject,
): HostUpdateGuidance | null {
  if (update.disconnected && update.phase !== null) {
    return {
      kind: "progress",
      text:
        subject === "Relay"
          ? "Relay is restarting. Waiting to verify the update; paired devices remain connected safely."
          : "Companion is restarting. Waiting to verify the update; the device remains paired.",
    };
  }
  if (update.errorMessage !== null) {
    return {
      kind: "failure",
      text: `${update.phase === "rolledBack" ? "Update rolled back" : "Update failed"}: ${update.errorMessage}`,
    };
  }
  return phaseGuidance(update.phase, subject) ?? availabilityGuidance(update, subject);
}

/**
 * The row's own action: apply a fresh target, or re-check. A shown failure
 * carries its own retry and check actions, so the row stays quiet then.
 */
export function hostUpdateRowAction(
  update: HostUpdateView,
  failureShown: boolean,
): "apply" | "check" | null {
  if (update.canApply && update.targetFingerprint !== null && !update.canRetry) {
    return "apply";
  }
  return update.canCheck && !update.canApply && !failureShown ? "check" : null;
}

function hostUpdateSummary(update: HostUpdateView): HostUpdateSummary {
  if (update.disconnected && update.phase !== null) {
    return muted("restarting");
  }
  if (update.errorMessage !== null) {
    return {
      text: update.phase === "rolledBack" ? "update rolled back" : "update failed",
      tone: "error",
    };
  }
  return phaseSummary(update.phase) ?? availabilitySummary(update);
}

function phaseSummary(phase: HostUpdateView["phase"]): HostUpdateSummary | null {
  switch (phase) {
    case "accepted":
      return muted("update accepted");
    case "installing":
      return muted("installing update");
    case "targetReady":
      return muted("ready to restart");
    case "awaitingReconnect":
      return muted("waiting to reconnect");
    case "rollingBack":
      return muted("rolling back");
    case "committed":
      return { text: "updated", tone: "success" };
    case "rolledBack":
      return { text: "update rolled back", tone: "error" };
    case "failed":
      return { text: "update failed", tone: "error" };
    case null:
    default:
      return null;
  }
}

function availabilitySummary(update: HostUpdateView): HostUpdateSummary {
  switch (update.availability) {
    case "ready":
      return update.latestVersion === null || update.latestVersion === update.currentVersion
        ? muted("up to date")
        : muted(`${update.latestVersion} available`);
    case "unsupported":
      return muted("remote updates unavailable");
    case "manualBootstrap":
      return muted("remote updates not set up");
    case "manualUpdate":
      return muted("manual update required");
    case "error":
      return muted("update check failed");
    case "loading":
    default:
      return muted("checking for updates");
  }
}

function phaseGuidance(
  phase: HostUpdateView["phase"],
  subject: HostUpdateSubject,
): HostUpdateGuidance | null {
  switch (phase) {
    case "accepted":
      return progress("Update accepted and protected by automatic rollback.");
    case "installing":
      return progress(`Installing the signed ${subject} update.`);
    case "targetReady":
      return progress(`The new ${subject} version is ready to restart.`);
    case "awaitingReconnect":
      return progress(`Waiting for the updated ${subject} to reconnect.`);
    case "rollingBack":
      return progress(`Verification failed. Restoring the previous ${subject} version.`);
    case "rolledBack":
      return {
        kind: "failure",
        text: `The update was rolled back safely. The previous ${subject} version is running.`,
      };
    case "failed":
      return {
        kind: "failure",
        text: `The update failed. The current ${subject} version keeps running.`,
      };
    case "committed":
    case null:
    default:
      return null;
  }
}

function availabilityGuidance(
  update: HostUpdateView,
  subject: HostUpdateSubject,
): HostUpdateGuidance | null {
  const command = installerCommand(update.platform);
  const install =
    command === null
      ? `Install the latest ${subject} on the server`
      : "Run the installer on the server";
  switch (update.availability) {
    case "unsupported":
      return {
        command,
        kind: "setup",
        text: `This ${subject} version cannot update remotely. ${install} once to enable updates from your phone.`,
      };
    case "manualBootstrap":
      return {
        command,
        kind: "setup",
        text: `${install} once to set up safe remote updates of ${subject}.`,
      };
    case "manualUpdate":
      return {
        command,
        kind: "setup",
        text: `This ${subject} requires a manual update. ${install} to update it.`,
      };
    case "ready":
    case "error":
    case "loading":
    default:
      return null;
  }
}

function installerCommand(platform: HostUpdatePlatform | null): string | null {
  switch (platform) {
    case "linux-x86-64":
      return `curl -fsSL ${INSTALLER_BASE_URL}/companion | sh`;
    case "relay-linux-x86-64":
      return `curl -fsSL ${INSTALLER_BASE_URL}/relay | sh`;
    case "macos-universal":
    case null:
    default:
      return null;
  }
}

function platformLabel(platform: HostUpdatePlatform): string {
  return platform === "macos-universal" ? "macOS" : "Linux";
}

function muted(text: string): HostUpdateSummary {
  return { text, tone: "muted" };
}

function progress(text: string): HostUpdateGuidance {
  return { kind: "progress", text };
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
