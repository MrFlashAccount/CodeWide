import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, radii, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

interface AccountUsageRowProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly plan: string;
  readonly reset: { readonly absolute: string; readonly relative: string | null } | null;
  readonly status: "active" | "exhausted" | "inactive" | "disabled";
  readonly testID?: string;
}

export function AccountUsageRow({
  children,
  label,
  plan,
  reset,
  status,
  testID,
}: AccountUsageRowProps) {
  return (
    <View style={styles.row} testID={testID}>
      <View
        accessibilityLabel={`Account ${status}`}
        accessible
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
          accessibilityLabel={`${plan}${reset === null ? "" : ` · Resets ${reset.absolute}${reset.relative === null ? "" : ` · ${reset.relative}`}`}`}
          accessible
          style={styles.metadataRow}
        >
          <Text numberOfLines={1} style={styles.metadata}>
            {plan}
          </Text>
          {reset !== null && (
            <>
              <Text style={styles.metadata}>·</Text>
              <Ionicons color={colors.textDim} name="refresh-outline" size={iconSize.indicator} />
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
  content: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  date: {
    flexShrink: 1,
    minWidth: 0,
  },
  dot: {
    borderRadius: radii.pill,
    height: 8,
    marginTop: spacing.compact,
    width: 8,
  },
  metadata: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
  },
  metadataRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.optical,
    minWidth: 0,
  },
  name: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
});
