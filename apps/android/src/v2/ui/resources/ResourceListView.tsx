import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type ResourceListRow = {
  detail?: string;
  id: string;
  label: string;
  onPress?: () => void;
  trailing?: ReactNode;
};

export function ResourceListView({
  empty,
  rows,
}: {
  empty: string;
  rows: ResourceListRow[];
}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {rows.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {rows.map((row) => {
        const body = (
          <>
            <View style={styles.copy}>
              <Text style={styles.label}>{row.label}</Text>
              {row.detail === undefined ? null : <Text style={styles.detail}>{row.detail}</Text>}
            </View>
            {row.trailing}
          </>
        );
        return row.onPress === undefined ? (
          <View key={row.id} style={styles.row}>
            {body}
          </View>
        ) : (
          <Pressable
            accessibilityLabel={row.label}
            accessibilityRole="button"
            key={row.id}
            onPress={row.onPress}
            style={styles.row}
          >
            {body}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10, padding: 16 },
  copy: { flex: 1, gap: 3 },
  detail: { color: "#a8a8ad", fontSize: 13 },
  empty: { color: "#a8a8ad", paddingVertical: 24, textAlign: "center" },
  label: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
  row: {
    alignItems: "center",
    backgroundColor: "#1b1b1e",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 14,
  },
});
