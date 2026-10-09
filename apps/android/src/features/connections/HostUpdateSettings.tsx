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
  readonly update: HostUpdateView;
};

/** Renders one server's update projection without owning transport or request state. */
export function HostUpdateSettings({
  connectionId,
  connectionName,
  onApply,
  onCheck,
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
    update,
  });

  return (
    <View accessibilityLabel="Companion update" style={styles.body} testID="host-update-settings">
      <HostUpdateMetadata pending={pending} update={update} />
      <HostUpdateNotice update={update} />
      <HostUpdateActions
        onApply={handlers.apply}
        onCheck={handlers.check}
        pending={pending}
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
      "Update Companion?",
      `${connectionName} will temporarily disconnect while Companion restarts. If the new version cannot start and reconnect safely, the device will automatically roll back to the current version.`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: confirmApply, text: "Update Companion" },
      ],
    );
  });
  return { apply, check };
}

function HostUpdateMetadata({
  pending,
  update,
}: {
  readonly pending: boolean;
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const currentVersion = update.currentVersion ?? "Unavailable";
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.label}>Companion version</Text>
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
  update,
}: {
  readonly onApply: () => void;
  readonly onCheck: () => void;
  readonly pending: boolean;
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const retry = update.canRetry;
  const showApply = update.canApply && update.targetFingerprint !== null;
  const showCheck = update.canCheck && !update.canApply;
  return (
    <View style={styles.actions}>
      {showApply && (
        <AppButton
          accessibilityLabel={retry ? "Retry Companion update" : "Update Companion"}
          accessibilityState={{ busy: pending }}
          isDisabled={pending}
          onPress={onApply}
          variant="primary"
        >
          {retry ? "Retry update" : "Update Companion"}
        </AppButton>
      )}
      {showCheck && (
        <AppButton
          accessibilityLabel="Check for Companion updates"
          onPress={onCheck}
          variant="secondary"
        >
          Check for updates
        </AppButton>
      )}
    </View>
  );
}

function platformLabel(platform: "linux-x86-64" | "macos-universal"): string {
  return platform === "macos-universal" ? "macOS" : "Linux";
}
