import type { PropsWithChildren, ReactNode } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export function WorkspaceView({
  children,
  subtitle,
  title,
}: PropsWithChildren<{ subtitle?: ReactNode; title: string }>): React.JSX.Element {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle === undefined ? null : <View>{subtitle}</View>}
      </View>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomColor: "#2e2e31",
    borderBottomWidth: 1,
    gap: 4,
  },
  root: { flex: 1, backgroundColor: "#0f0f10" },
  title: { color: "#fafafa", fontSize: 22, fontWeight: "700" },
});
