import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { ShimmerText } from "../text/ShimmerText";
import { PresentationText as Text } from "../text/ProductText";

interface WorkspaceSubtitleViewProps {
  text: string;
  updating?: boolean;
}

export function WorkspaceSubtitleView(props: WorkspaceSubtitleViewProps): React.JSX.Element {
  const { text, updating = false } = props;
  if (updating)
    return <ShimmerText style={styles.subtitleText} text="Updating" widthPolicy="intrinsic" />;
  return (
    <Text ellipsizeMode="middle" numberOfLines={1} style={styles.subtitleText}>
      {text}
    </Text>
  );
}

export function WorkspaceView(
  props: PropsWithChildren<{
    actions?: ReactNode;
    leading?: ReactNode;
    subtitle?: ReactNode;
    title: ReactNode;
  }>,
): React.JSX.Element {
  const { actions, children, leading, subtitle, title } = props;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {leading === undefined ? null : <View style={styles.leading}>{leading}</View>}
        <View style={styles.identity}>
          {typeof title === "string" ? (
            <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : (
            title
          )}
          {subtitle === undefined ? null : (
            <View style={styles.subtitle}>
              {typeof subtitle === "string" ? <WorkspaceSubtitleView text={subtitle} /> : subtitle}
            </View>
          )}
        </View>
        {actions === undefined ? null : <View style={styles.actions}>{actions}</View>}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "center", flexDirection: "row" },
  content: { flex: 1, minHeight: 0 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    minHeight: 56,
    paddingLeft: spacing.xs,
  },
  identity: { flex: 1, minWidth: 0 },
  leading: { alignItems: "center", justifyContent: "center" },
  root: { backgroundColor: colors.background, flex: 1 },
  subtitle: { marginTop: spacing.optical },
  subtitleText: { color: colors.textMuted, ...typeScale.label },
  title: {
    alignSelf: "flex-start",
    color: colors.text,
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    ...typeScale.title,
  },
});
