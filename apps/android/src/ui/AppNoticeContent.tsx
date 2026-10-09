import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";

import { colors, iconSize, typeScale, typeWeight } from "../theme";
import type { AppNoticeRequest } from "./appNoticeContext";
import { AppText as Text } from "./Typography";

const ACTION_RADIUS = 10;
const ACTION_PADDING_X = 13;
const ACTION_PADDING_Y = 7;
const BODY_GAP = 3;

const variantIcons = {
  default: null,
  error: "close-circle",
  info: "information-circle",
  success: "checkmark-circle",
  warning: "warning",
} as const;
const variantColors = {
  default: colors.text,
  error: colors.red,
  info: colors.nebula,
  success: colors.green,
  warning: colors.amber,
} as const;

/** The CodeWide-colored ReactiCx title, description, icon, and action layout. */
export function AppNoticeContent({
  onAction,
  request,
}: {
  readonly onAction: (event: GestureResponderEvent) => void;
  readonly request: AppNoticeRequest;
}): React.JSX.Element {
  return (
    <>
      <NoticeIcon request={request} />
      <View style={styles.content}>
        <Text style={styles.title}>{request.label}</Text>
        {request.description === undefined ? null : (
          <Text numberOfLines={2} style={styles.description}>
            {request.description}
          </Text>
        )}
      </View>
      <NoticeAction onAction={onAction} request={request} />
    </>
  );
}

function NoticeIcon({ request }: { readonly request: AppNoticeRequest }): React.JSX.Element | null {
  const variant = request.variant ?? "default";
  const iconName = variantIcons[variant];
  if (request.icon === undefined && iconName === null) {
    return null;
  }
  return (
    <View style={styles.icon}>
      {request.icon ??
        (iconName === null ? null : (
          <Ionicons color={variantColors[variant]} name={iconName} size={iconSize.action} />
        ))}
    </View>
  );
}

function NoticeAction({
  onAction,
  request,
}: {
  readonly onAction: (event: GestureResponderEvent) => void;
  readonly request: AppNoticeRequest;
}): React.JSX.Element | null {
  if (request.actionLabel === undefined || request.onActionPress === undefined) {
    return null;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}>
      <Text style={styles.actionLabel}>{request.actionLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: colors.text,
    borderRadius: ACTION_RADIUS,
    paddingHorizontal: ACTION_PADDING_X,
    paddingVertical: ACTION_PADDING_Y,
  },
  actionLabel: {
    color: colors.surface,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  content: {
    flex: 1,
    gap: BODY_GAP,
    minWidth: 0,
  },
  description: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
});
