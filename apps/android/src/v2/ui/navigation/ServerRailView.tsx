import { Pressable, StyleSheet, Text, View } from "react-native";

export type ServerRailRow = { detail: string; emoji: string; id: string; label: string };

export function ServerRailView({
  onOpen,
  rows,
}: {
  onOpen(id: string): void;
  rows: ServerRailRow[];
}): React.JSX.Element {
  return (
    <View accessibilityLabel="V2 saved servers" style={styles.list}>
      {rows.map((row) => (
        <Pressable
          accessibilityLabel={`Open ${row.label}`}
          accessibilityRole="button"
          key={row.id}
          onPress={() => {
            onOpen(row.id);
          }}
          style={styles.row}
        >
          <Text style={styles.emoji}>{row.emoji}</Text>
          <View style={styles.copy}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.detail}>{row.detail}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: { color: "#a1a1aa", fontSize: 28 },
  copy: { flex: 1, gap: 2 },
  detail: { color: "#a1a1aa", fontSize: 13 },
  emoji: { fontSize: 24 },
  label: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
  list: { padding: 16, gap: 10 },
  row: {
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: "#1c1c1f",
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
});
