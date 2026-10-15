import {
  isTerminalHostUpdatePhase,
  type HostUpdatePlatform,
  type HostUpdateProgress,
} from "./hostUpdateContract";
import type { HostUpdateView } from "./hostUpdateSettingsContract";

const PERCENT_SCALE = 100;
const BYTES_PER_MEGABYTE = 1_000_000;

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
export function hostUpdateDescription(
  update: HostUpdateView,
  subject: HostUpdateSubject,
): HostUpdateSummary {
  const summary = hostUpdateSummary(update, subject);
  return update.platform === null
    ? { text: capitalized(summary.text), tone: summary.tone }
    : { text: `${platformLabel(update.platform)} · ${summary.text}`, tone: summary.tone };
}

/** The explanation below the row, or `null` when the summary says everything. */
export function hostUpdateGuidance(
  update: HostUpdateView,
  subject: HostUpdateSubject,
): HostUpdateGuidance | null {
  if (update.disconnected) {
    // A restart or a lost connection is expected during an update; it is not a failure.
    return {
      kind: "progress",
      text: `Last confirmed: ${confirmedStep(update, subject)}. Waiting for fresh ${subject} status; the device remains paired.`,
    };
  }
  if (update.progress !== null) {
    const reason = update.errorMessage === null ? "" : ` Reason: ${update.errorMessage}`;
    return {
      kind: "progress",
      text: `${progressText(update.progress, subject)}. ${subject} is reachable.${reason}`,
    };
  }
  if (update.errorMessage !== null) {
    return {
      kind: "failure",
      text: `${capitalized(failureLabel(update.phase))}: ${update.errorMessage}`,
    };
  }
  return phaseGuidance(update.phase, subject) ?? availabilityGuidance(update, subject);
}

/** Gives an active update priority over expected reconnect diagnostics. */
export function hostUpdateConnectionLabel(update: HostUpdateView | undefined): string | null {
  if (update === undefined || update.phase === null || isTerminalHostUpdatePhase(update.phase)) {
    return null;
  }
  const step = confirmedStep(update, "Companion");
  return update.disconnected ? `${step} · reconnecting` : step;
}

/** The latest state the server confirmed: its progress, phase or update availability. */
function confirmedStep(update: HostUpdateView, subject: HostUpdateSubject): string {
  if (update.progress !== null) {
    return progressText(update.progress, subject);
  }
  return phaseSummary(update.phase)?.text ?? availabilitySummary(update).text;
}

/** Platform-neutral: Linux and macOS report the same progress stages. */
function progressText(progress: HostUpdateProgress, subject: HostUpdateSubject): string {
  if (progress.stage === "downloading") {
    const downloaded = megabytes(progress.downloadedBytes);
    if (progress.totalBytes === null || progress.totalBytes === 0) {
      return `Downloading · ${downloaded} MB`;
    }
    const percent = Math.min(
      PERCENT_SCALE,
      Math.floor((progress.downloadedBytes / progress.totalBytes) * PERCENT_SCALE),
    );
    return `Downloading · ${String(percent)}% · ${downloaded} / ${megabytes(progress.totalBytes)} MB`;
  }
  const labels = {
    awaitingReconnect: "Waiting for phone confirmation",
    checkingHealth: "Checking server readiness",
    extracting: "Unpacking update",
    restarting: `Restarting ${subject}`,
    rollingBack: "Restoring previous version",
    verifying: "Verifying download",
  } as const;
  return labels[progress.stage];
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(1);
}

/**
 * The row's own action: apply a fresh target, or re-check. A shown failure
 * carries its own retry and check actions, so the row stays quiet then. A
 * pending request keeps its action in place, disabled, until the server answers.
 */
export function hostUpdateRowAction(
  update: HostUpdateView,
  failureShown: boolean,
): "apply" | "check" | null {
  if (update.pending !== null) {
    return update.pending;
  }
  if (update.canApply && update.targetFingerprint !== null && !update.canRetry) {
    return "apply";
  }
  return update.canCheck && !update.canApply && !failureShown ? "check" : null;
}

function hostUpdateSummary(update: HostUpdateView, subject: HostUpdateSubject): HostUpdateSummary {
  if (update.disconnected) {
    return muted(`${confirmedStep(update, subject)} · reconnecting`);
  }
  if (update.progress !== null) {
    return muted(progressText(update.progress, subject));
  }
  if (update.errorMessage !== null) {
    return { text: failureLabel(update.phase), tone: "error" };
  }
  return phaseSummary(update.phase) ?? availabilitySummary(update);
}

/**
 * Names what failed. Without a phase no update ran: a status read, check or
 * apply request was refused or could not reach the server.
 */
function failureLabel(phase: HostUpdateView["phase"]): string {
  if (phase === null) {
    return "update request failed";
  }
  return phase === "rolledBack" ? "update rolled back" : "update failed";
}

function phaseSummary(phase: HostUpdateView["phase"]): HostUpdateSummary | null {
  switch (phase) {
    case "accepted":
      return muted("update accepted");
    case "installing":
      return muted("installing update");
    case "targetReady":
      return muted("updated server ready");
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
    case "unofficialBuild":
      return muted("unofficial build");
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
      return progress(`The updated ${subject} is ready. Waiting for phone confirmation.`);
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
  const install = installInstruction(subject, command !== null);
  switch (update.availability) {
    case "unofficialBuild":
      return {
        command: null,
        kind: "setup",
        text: `This ${subject} was built outside an official release, so it cannot update remotely. Install an official release to enable remote updates.`,
      };
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

/** Relay runs on its own host, so its installer runs there, not on this server. */
function installInstruction(subject: HostUpdateSubject, hasCommand: boolean): string {
  if (subject === "Relay") {
    return hasCommand ? "Run the Relay installer on the Relay host" : "Reinstall Relay on its host";
  }
  return hasCommand
    ? "Run the official installer on this server"
    : `Install the latest official ${subject} release on this server`;
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
