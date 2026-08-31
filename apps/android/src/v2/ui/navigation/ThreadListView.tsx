import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type ThreadListRow = {
  id: string;
  retained: boolean;
  state: string;
  title: string;
  updatedAt: string;
};

export function ThreadListView({
  onOpen,
  rows,
}: {
  onOpen(id: string): void;
  rows: ThreadListRow[];
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.muted}>No projected threads yet.</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {rows.map((row) => (
        <Pressable
          accessibilityLabel={`Open thread ${row.title} ${row.id}`}
          key={row.id}
          onPress={() => {
            onOpen(row.id);
          }}
          style={styles.row}
        >
          <Text style={styles.title}>{row.title}</Text>
          <Text style={styles.muted}>
            {row.state} · {row.updatedAt}
            {row.retained ? " · retained" : ""}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { padding: 16, gap: 10 },
  muted: { color: "#a1a1aa" },
  row: { borderRadius: 14, backgroundColor: "#1c1c1f", padding: 16, gap: 6 },
  title: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
});
