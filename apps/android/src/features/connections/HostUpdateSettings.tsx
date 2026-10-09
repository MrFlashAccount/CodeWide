import { View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { AppButton } from "../../presentation/controls/AppButton";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { isTerminalHostUpdatePhase } from "./hostUpdateContract";
import { HostUpdateNotice } from "./HostUpdateNotice";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { styles } from "./HostUpdateSettings.styles";

type HostUpdateSettingsProps = {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly onApply: (connectionId: string, targetFingerprint: string) => Promise<void>;
  readonly onCheck: (connectionId: string) => Promise<void>;
  readonly subject?: "Companion" | "Relay";
  readonly update: HostUpdateView;
};

/** Renders one server's update projection without owning transport or request state. */
export function HostUpdateSettings({
  connectionId,
  connectionName,
  onApply,
  onCheck,
  subject = "Companion",
  update,
}: HostUpdateSettingsProps): React.JSX.Element {
  const dialog = useAppDialog();
  const pending = update.phase !== null && !isTerminalHostUpdatePhase(update.phase);
  const handlers = useHostUpdateHandlers({
    connectionId,
    connectionName,
    dialog,
    onApply,
    onCheck,
    subject,
    update,
  });

  return (
    <View
      accessibilityLabel={`${subject} update`}
      style={styles.body}
      testID={subject === "Companion" ? "host-update-settings" : "relay-update-settings"}
    >
      <HostUpdateMetadata pending={pending} subject={subject} update={update} />
      <HostUpdateNotice subject={subject} update={update} />
      <HostUpdateActions
        onApply={handlers.apply}
        onCheck={handlers.check}
        pending={pending}
        subject={subject}
        update={update}
      />
    </View>
  );
}

function useHostUpdateHandlers({
  connectionId,
  connectionName,
  dialog,
  onApply,
  onCheck,
  subject = "Companion",
  update,
}: HostUpdateSettingsProps & { readonly dialog: ReturnType<typeof useAppDialog> }): {
  readonly apply: () => void;
  readonly check: () => void;
} {
  const check = useEvent(() => {
    onCheck(connectionId).catch(() => undefined);
  });
  const confirmApply = useEvent(() => {
    const fingerprint = update.targetFingerprint;
    if (fingerprint === null || !update.canApply) {
      return;
    }
    onApply(connectionId, fingerprint).catch(() => undefined);
  });
  const apply = useEvent(() => {
    if (update.targetFingerprint === null || !update.canApply) {
      return;
    }
    dialog.alert(
      `Update ${subject}?`,
      `${connectionName}'s ${subject} connection will temporarily disconnect while ${subject} restarts. If the new version cannot start and reconnect safely, it will automatically roll back to the current version.`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: confirmApply, text: `Update ${subject}` },
      ],
    );
  });
  return { apply, check };
}

function HostUpdateMetadata({
  pending,
  subject,
  update,
}: {
  readonly pending: boolean;
  readonly subject: "Companion" | "Relay";
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const currentVersion = update.currentVersion ?? "Unavailable";
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.label}>{subject} version</Text>
        {pending ? (
          <WaveText
            containerStyle={styles.versionShimmer}
            style={styles.value}
            testID="host-update-version-shimmer"
            text={currentVersion}
          />
        ) : (
          <Text style={styles.value}>{currentVersion}</Text>
        )}
      </View>
      {update.platform !== null && (
        <View style={styles.row}>
          <Text style={styles.label}>Platform</Text>
          <Text style={styles.value}>{platformLabel(update.platform)}</Text>
        </View>
      )}
      {update.latestVersion !== null && update.latestVersion !== update.currentVersion && (
        <View style={styles.row}>
          <Text style={styles.label}>Available version</Text>
          <Text style={styles.value}>{update.latestVersion}</Text>
        </View>
      )}
    </>
  );
}

function HostUpdateActions({
  onApply,
  onCheck,
  pending,
  subject,
  update,
}: {
  readonly onApply: () => void;
  readonly onCheck: () => void;
  readonly pending: boolean;
  readonly subject: "Companion" | "Relay";
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const retry = update.canRetry;
  const showApply = update.canApply && update.targetFingerprint !== null;
  const showCheck = update.canCheck && !update.canApply;
  return (
    <View style={styles.actions}>
      {showApply && (
        <AppButton
          accessibilityLabel={retry ? `Retry ${subject} update` : `Update ${subject}`}
          accessibilityState={{ busy: pending }}
          isDisabled={pending}
          onPress={onApply}
          variant="primary"
        >
          {retry ? "Retry update" : `Update ${subject}`}
        </AppButton>
      )}
      {showCheck && (
        <AppButton
          accessibilityLabel={`Check for ${subject} updates`}
          onPress={onCheck}
          variant="secondary"
        >
          Check for updates
        </AppButton>
      )}
    </View>
  );
}

function platformLabel(
  platform: "linux-x86-64" | "macos-universal" | "relay-linux-x86-64",
): string {
  if (platform === "macos-universal") {
    return "macOS";
  }
  return platform === "relay-linux-x86-64" ? "Relay · Linux" : "Linux";
}
