import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppNoticeContext, type AppNoticeRequest } from "./appNoticeContext";
import { AppText as Text } from "./Typography";

const DEFAULT_NOTICE_DURATION_MS = 6000;
const NOTICE_ELEVATION = 12;

/** Owns the single transient application notice surface. */
export function AppNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [request, setRequest] = useState<AppNoticeRequest | null>(null);
  const hide = useEvent(() => {
    setRequest(null);
  });
  const show = useEvent((next: AppNoticeRequest) => {
    setRequest(next);
  });

  useEffect(() => {
    if (request === null) {
      return undefined;
    }
    const timeout = setTimeout(hide, request.duration ?? DEFAULT_NOTICE_DURATION_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [hide, request]);

  return (
    <AppNoticeContext.Provider value={{ show }}>
      {children}
      {request === null ? null : <Notice onHide={hide} request={request} />}
    </AppNoticeContext.Provider>
  );
}

function Notice({
  onHide,
  request,
}: {
  readonly onHide: () => void;
  readonly request: AppNoticeRequest;
}): React.JSX.Element {
  const activate = useEvent(() => {
    onHide();
    request.onActionPress?.();
  });
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      {request.icon}
      <View style={styles.copy}>
        <Text style={styles.label}>{request.label}</Text>
        {request.description === undefined ? null : (
          <Text numberOfLines={2} style={styles.description}>
            {request.description}
          </Text>
        )}
      </View>
      {request.actionLabel === undefined || request.onActionPress === undefined ? null : (
        <Pressable accessibilityRole="button" onPress={activate} style={styles.action}>
          <Text style={styles.actionLabel}>{request.actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    padding: spacing.xs,
  },
  actionLabel: {
    color: colors.primary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  copy: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  description: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  label: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  notice: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    bottom: spacing.md,
    elevation: NOTICE_ELEVATION,
    flexDirection: "row",
    gap: spacing.sm,
    left: spacing.md,
    padding: spacing.sm,
    position: "absolute",
    right: spacing.md,
  },
});
