import Ionicons from "@expo/vector-icons/Ionicons";
import { setStringAsync } from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { AppButton } from "../../presentation/controls/AppButton";
import { colors, iconSize } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { isTerminalHostUpdatePhase } from "./hostUpdateContract";
import {
  hostUpdateDescription,
  hostUpdateGuidance,
  hostUpdateRowAction,
  type HostUpdateGuidance,
  type HostUpdateSubject,
} from "./hostUpdatePresentation";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { styles } from "./HostUpdateSettings.styles";

type HostUpdateSettingsProps = {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly onApply: (connectionId: string, targetFingerprint: string) => Promise<void>;
  readonly onCheck: (connectionId: string) => Promise<void>;
  readonly subject?: HostUpdateSubject;
  readonly update: HostUpdateView;
};

type HostUpdateActions = {
  readonly apply: () => void;
  readonly check: () => void;
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
  const actions = useHostUpdateHandlers({
    connectionId,
    connectionName,
    dialog,
    onApply,
    onCheck,
    subject,
    update,
  });
  const guidance = hostUpdateGuidance(update, subject);
  return (
    <View
      accessibilityLabel={`${subject} update`}
      style={styles.card}
      testID={subject === "Companion" ? "host-update-settings" : "relay-update-settings"}
    >
      <HostUpdateRow
        actions={actions}
        failureShown={guidance?.kind === "failure"}
        subject={subject}
        update={update}
      />
      {guidance !== null && (
        <HostUpdateCallout
          actions={actions}
          guidance={guidance}
          subject={subject}
          update={update}
        />
      )}
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
}: HostUpdateSettingsProps & {
  readonly dialog: ReturnType<typeof useAppDialog>;
}): HostUpdateActions {
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

/** Version title, one-line state and the row's own action. */
function HostUpdateRow({
  actions,
  failureShown,
  subject,
  update,
}: {
  readonly actions: HostUpdateActions;
  readonly failureShown: boolean;
  readonly subject: HostUpdateSubject;
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const pending = update.phase !== null && !isTerminalHostUpdatePhase(update.phase);
  const description = hostUpdateDescription(update);
  return (
    <View style={styles.row}>
      <Ionicons
        color={colors.textMuted}
        name={subject === "Relay" ? "git-network-outline" : "cube-outline"}
        size={iconSize.action}
      />
      <View style={styles.text}>
        <HostUpdateTitle
          pending={pending}
          title={`${subject} ${update.currentVersion ?? "version unavailable"}`}
        />
        <Text style={[styles.description, toneStyle(description.tone)]}>{description.text}</Text>
      </View>
      <HostUpdateRowAction
        action={hostUpdateRowAction(update, failureShown)}
        actions={actions}
        pending={pending}
        subject={subject}
      />
    </View>
  );
}

/** The real version text; it shimmers in place while an update is pending. */
function HostUpdateTitle({
  pending,
  title,
}: {
  readonly pending: boolean;
  readonly title: string;
}): React.JSX.Element {
  return pending ? (
    <WaveText
      containerStyle={styles.titleShimmer}
      style={styles.title}
      testID="host-update-version-shimmer"
      text={title}
    />
  ) : (
    <Text numberOfLines={1} style={styles.title}>
      {title}
    </Text>
  );
}

function HostUpdateRowAction({
  action,
  actions,
  pending,
  subject,
}: {
  readonly action: "apply" | "check" | null;
  readonly actions: HostUpdateActions;
  readonly pending: boolean;
  readonly subject: HostUpdateSubject;
}): React.JSX.Element | null {
  if (action === "apply") {
    return (
      <AppButton
        accessibilityLabel={`Update ${subject}`}
        accessibilityState={{ busy: pending }}
        isDisabled={pending}
        onPress={actions.apply}
        size="sm"
        variant="primary"
      >
        Update
      </AppButton>
    );
  }
  if (action === "check") {
    return (
      <AppButton
        accessibilityLabel={`Check for ${subject} updates`}
        isIconOnly
        onPress={actions.check}
        size="sm"
        variant="ghost"
      >
        <Ionicons color={colors.textMuted} name="refresh-outline" size={iconSize.action} />
      </AppButton>
    );
  }
  return null;
}

const CALLOUT_LOOK = {
  failure: {
    iconColor: colors.red,
    iconName: "alert-circle-outline",
    liveRegion: "assertive",
    surface: styles.calloutError,
    text: styles.calloutTextError,
  },
  neutral: {
    iconColor: colors.textMuted,
    iconName: "information-circle-outline",
    liveRegion: "polite",
    surface: styles.callout,
    text: styles.calloutText,
  },
} as const;

/** Explanation under the row: neutral for progress and setup, error-tinted for failures. */
function HostUpdateCallout({
  actions,
  guidance,
  subject,
  update,
}: {
  readonly actions: HostUpdateActions;
  readonly guidance: HostUpdateGuidance;
  readonly subject: HostUpdateSubject;
  readonly update: HostUpdateView;
}): React.JSX.Element {
  const look = CALLOUT_LOOK[guidance.kind === "failure" ? "failure" : "neutral"];
  return (
    <View style={look.surface}>
      <Ionicons
        color={look.iconColor}
        name={look.iconName}
        size={iconSize.inline}
        style={styles.calloutIcon}
      />
      <View style={styles.calloutBody}>
        <Text accessibilityLiveRegion={look.liveRegion} style={look.text}>
          {guidance.text}
        </Text>
        {guidance.kind === "setup" && guidance.command !== null && (
          <InstallerCommand command={guidance.command} />
        )}
        {guidance.kind === "failure" && (
          <FailureActions actions={actions} subject={subject} update={update} />
        )}
      </View>
    </View>
  );
}

function InstallerCommand({ command }: { readonly command: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = useEvent(() => {
    setStringAsync(command).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  });
  return (
    <>
      <Text numberOfLines={2} selectable style={styles.command}>
        {command}
      </Text>
      <View style={styles.calloutActions}>
        <AppButton
          accessibilityLabel="Copy installer command"
          onPress={copy}
          size="sm"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy command"}
        </AppButton>
      </View>
    </>
  );
}

function FailureActions({
  actions,
  subject,
  update,
}: {
  readonly actions: HostUpdateActions;
  readonly subject: HostUpdateSubject;
  readonly update: HostUpdateView;
}): React.JSX.Element | null {
  const retry = update.canRetry && update.canApply && update.targetFingerprint !== null;
  const check = update.canCheck && !update.canApply;
  if (!retry && !check) {
    return null;
  }
  return (
    <View style={styles.calloutActions}>
      {retry && (
        <AppButton
          accessibilityLabel={`Retry ${subject} update`}
          onPress={actions.apply}
          size="sm"
          variant="secondary"
        >
          Retry update
        </AppButton>
      )}
      {check && (
        <AppButton
          accessibilityLabel={`Check for ${subject} updates`}
          onPress={actions.check}
          size="sm"
          variant="secondary"
        >
          Check again
        </AppButton>
      )}
    </View>
  );
}

function toneStyle(tone: "error" | "muted" | "success") {
  if (tone === "error") {
    return styles.descriptionError;
  }
  return tone === "success" ? styles.descriptionSuccess : undefined;
}
