import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, radii, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

interface AccountUsageRowProps {
  readonly testID?: string;
  readonly label: string;
  readonly plan: string;
  readonly status: "active" | "exhausted" | "inactive" | "disabled";
  readonly reset: { readonly absolute: string; readonly relative: string | null } | null;
  readonly children: ReactNode;
}

export function AccountUsageRow({
  testID,
  label,
  plan,
  status,
  reset,
  children,
}: AccountUsageRowProps) {
  return (
    <View testID={testID} style={styles.row}>
      <View
        accessible
        accessibilityLabel={`Account ${status}`}
        style={[
          styles.dot,
          {
            backgroundColor:
              status === "exhausted"
                ? colors.red
                : status === "active"
                  ? colors.green
                  : colors.textDim,
          },
        ]}
      />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.name}>
            {label}
          </Text>
          {children}
        </View>
        <View
          accessible
          style={styles.metadataRow}
          accessibilityLabel={`${plan}${reset === null ? "" : ` · Resets ${reset.absolute}${reset.relative === null ? "" : ` · ${reset.relative}`}`}`}
        >
          <Text numberOfLines={1} style={styles.metadata}>
            {plan}
          </Text>
          {reset !== null && (
            <>
              <Text style={styles.metadata}>·</Text>
              <Ionicons name="refresh-outline" size={iconSize.indicator} color={colors.textDim} />
              <Text numberOfLines={1} style={[styles.metadata, styles.date]}>
                {reset.absolute}
              </Text>
              {reset.relative !== null && (
                <Text numberOfLines={1} style={styles.metadata}>
                  · {reset.relative}
                </Text>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    marginTop: spacing.compact,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  name: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
  metadataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
    minWidth: 0,
  },
  metadata: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
  },
  date: {
    flexShrink: 1,
    minWidth: 0,
  },
});
