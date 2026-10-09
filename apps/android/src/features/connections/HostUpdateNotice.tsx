import { AppText as Text } from "../../ui/Typography";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { styles } from "./HostUpdateSettings.styles";

/** Announces durable update progress and recovery without replacing version text. */
export function HostUpdateNotice({
  subject = "Companion",
  update,
}: {
  readonly subject?: "Companion" | "Relay";
  readonly update: HostUpdateView;
}): React.JSX.Element {
  if (update.disconnected && update.phase !== null) {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {subject === "Relay"
          ? "Relay is restarting. Waiting to verify the update; paired devices remain connected safely."
          : "Companion is restarting. Waiting to verify the update; the device remains paired."}
      </Text>
    );
  }
  if (update.errorMessage !== null) {
    return (
      <Text accessibilityLiveRegion="assertive" style={styles.error}>
        {update.phase === "rolledBack" ? "Update rolled back: " : "Update failed: "}
        {update.errorMessage}
      </Text>
    );
  }
  const operation = operationNotice(update.phase, subject);
  if (operation !== null) {
    return (
      <Text accessibilityLiveRegion={operation.liveRegion} style={operation.style}>
        {operation.text}
      </Text>
    );
  }
  return <Text style={styles.detail}>{availabilityNotice(update, subject)}</Text>;
}

function operationNotice(
  phase: HostUpdateView["phase"],
  subject: "Companion" | "Relay",
): {
  readonly liveRegion: "assertive" | "polite";
  readonly style: typeof styles.error | typeof styles.status | typeof styles.success;
  readonly text: string;
} | null {
  switch (phase) {
    case "accepted":
      return notice("Update accepted and protected by automatic rollback.");
    case "installing":
      return notice(`Installing the signed ${subject} update.`);
    case "targetReady":
      return notice(`The new ${subject} version is ready to restart.`);
    case "awaitingReconnect":
      return notice(`Waiting for the updated ${subject} to reconnect.`);
    case "rollingBack":
      return notice(`Verification failed. Restoring the previous ${subject} version.`);
    case "committed":
      return {
        liveRegion: "polite",
        style: styles.success,
        text: `${subject} updated and reconnected successfully.`,
      };
    case "rolledBack":
      return {
        liveRegion: "assertive",
        style: styles.error,
        text: `The update was rolled back safely. The previous ${subject} version is running.`,
      };
    case "failed":
    case null:
    default:
      return null;
  }
}

function notice(text: string) {
  return { liveRegion: "polite" as const, style: styles.status, text };
}

function availabilityNotice(update: HostUpdateView, subject: "Companion" | "Relay"): string {
  switch (update.availability) {
    case "unsupported":
      return `This ${subject} version cannot update remotely. Update it manually once to enable this control.`;
    case "manualBootstrap":
      return subject === "Relay"
        ? "Relay Updater must be installed manually once before safe remote updates are available."
        : "The update guardian must be installed manually before safe remote updates are available.";
    case "manualUpdate":
      return `This ${subject} requires a manual update.`;
    case "ready":
      return update.currentVersion !== null && update.latestVersion === null
        ? `${subject} is up to date.`
        : `Signed ${subject} update information is available.`;
    case "error":
      return "Check for updates again to continue.";
    case "loading":
    default:
      return `Checking signed ${subject} releases.`;
  }
}
