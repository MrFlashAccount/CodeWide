import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";

import { colors, iconSize } from "../theme";
import type { AppNoticeRequest } from "./appNoticeContext";
import { AppText as Text } from "./Typography";

const ACTION_RADIUS = 10;
const ACTION_PADDING_X = 13;
const ACTION_PADDING_Y = 7;
const ACTION_FONT_SIZE = 13;
const BODY_GAP = 3;
const DESCRIPTION_FONT_SIZE = 13;
const DESCRIPTION_LINE_HEIGHT = 18;
const TITLE_FONT_SIZE = 14;
const TITLE_LINE_HEIGHT = 19;
const WEIGHT_BOLD = "700";
const WEIGHT_MEDIUM = "500";

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
    fontSize: ACTION_FONT_SIZE,
    fontWeight: WEIGHT_BOLD,
  },
  content: {
    flex: 1,
    gap: BODY_GAP,
    minWidth: 0,
  },
  description: {
    color: colors.textMuted,
    fontSize: DESCRIPTION_FONT_SIZE,
    fontWeight: WEIGHT_MEDIUM,
    lineHeight: DESCRIPTION_LINE_HEIGHT,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    fontSize: TITLE_FONT_SIZE,
    fontWeight: WEIGHT_BOLD,
    lineHeight: TITLE_LINE_HEIGHT,
  },
});
