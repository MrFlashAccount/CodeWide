import { use, useRef, useState, type ReactElement } from "react";
import { Switch, View } from "react-native";

import {
  isNotificationMode,
  notificationModes,
  setAgentNotificationMode,
  setAgentNotificationsEnabled,
  type AgentNotificationSettings,
  type NotificationEvent,
  type NotificationMode,
  type readAgentNotificationSettings,
} from "../../native/agentNotificationSettings";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { SettingsGroupHeader } from "../../ui/SettingsGroupHeader";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

const events = [
  { event: "answer", icon: "checkmark-circle-outline", title: "Answer ready" },
  { event: "input", icon: "chatbubble-ellipses-outline", title: "Needs your input" },
  { event: "failure", icon: "alert-circle-outline", title: "Agent error" },
] as const;

const modeLabels: Readonly<Record<NotificationMode, string>> = {
  off: "Off",
  silent: "Silent",
  system: "Android default",
};

/** Presents the Android service's saved choices once the navigation read completes. */
export function NotificationSettings({
  initial,
  onRetry,
}: {
  readonly initial: ReturnType<typeof readAgentNotificationSettings>;
  readonly onRetry: () => void;
}): ReactElement {
  const result = use(initial);
  if (result.kind === "error") {
    return (
      <AppListRow
        description={result.message}
        onPress={onRetry}
        title="Retry notification settings"
      />
    );
  }
  return <NotificationControls initial={result.settings} />;
}

function NotificationControls({
  initial,
}: {
  readonly initial: AgentNotificationSettings;
}): ReactElement {
  const [settings, setSettings] = useState(initial);
  const [pending, setPending] = useState<NotificationEvent | "enabled" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const save = useEvent(
    (
      change:
        | { readonly enabled: boolean; readonly field: "enabled" }
        | { readonly field: NotificationEvent; readonly mode: NotificationMode },
    ) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setError(null);
      setPending(change.field);
      const update =
        change.field === "enabled"
          ? setAgentNotificationsEnabled(change.enabled)
          : setAgentNotificationMode(change.field, change.mode);
      update.then(
        (confirmed) => {
          setSettings(confirmed);
          setPending(null);
          inFlight.current = false;
        },
        (error: unknown) => {
          setError(error instanceof Error ? error.message : "Could not save notification settings");
          setPending(null);
          inFlight.current = false;
        },
      );
    },
  );
  const toggle = useEvent((enabled: boolean) => {
    save({ enabled, field: "enabled" });
  });
  const select = useEvent((event: NotificationEvent, mode: NotificationMode) => {
    if (settings.enabled && settings[event] !== mode) {
      save({ field: event, mode });
    }
  });
  return (
    <>
      <AppListRow
        fixedHeight={listRowHeight.single}
        shimmering={pending === "enabled"}
        title="Agent notifications"
        trailing={
          <Switch
            accessibilityLabel="Agent notifications"
            accessible
            disabled={pending !== null}
            onValueChange={toggle}
            value={settings.enabled}
          />
        }
      />
      <View>
        <SettingsGroupHeader title="Events" />
        {events.map((item, index) => (
          <EventModeRow
            disabled={!settings.enabled || pending !== null}
            item={item}
            key={item.event}
            mode={settings[item.event]}
            pending={pending === item.event}
            position={listRowPosition(index, events.length)}
            select={select}
          />
        ))}
      </View>
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {error}
        </Text>
      )}
    </>
  );
}

function EventModeRow({
  disabled,
  item,
  mode,
  pending,
  position,
  select,
}: {
  readonly disabled: boolean;
  readonly item: (typeof events)[number];
  readonly mode: NotificationMode;
  readonly pending: boolean;
  readonly position: ReturnType<typeof listRowPosition>;
  readonly select: (event: NotificationEvent, mode: NotificationMode) => void;
}): ReactElement {
  const selectMode = useEvent((value: string) => {
    if (!disabled && isNotificationMode(value)) {
      select(item.event, value);
    }
  });
  return (
    <ActionMenu
      accessibilityLabel={item.title}
      actions={notificationModes.map((id) => ({
        id,
        label: modeLabels[id],
        selected: mode === id,
      }))}
      onSelect={selectMode}
    >
      <AppListRow
        accessibilityLabel={item.title + ", " + modeLabels[mode]}
        description={modeLabels[mode]}
        disabled={disabled}
        fixedHeight={listRowHeight.double}
        leadingIcon={{ color: colors.textMuted, name: item.icon, size: iconSize.action }}
        position={position}
        shimmering={pending}
        title={item.title}
        trailingIcon={{ color: colors.textMuted, name: "chevron-down", size: iconSize.inline }}
      />
    </ActionMenu>
  );
}
