import { ScrollView, StyleSheet, Text, View } from "react-native";

type TimelineDisplayRow = { id: string; role: "user" | "assistant" | "system"; text: string };

export function TimelineView({ rows }: { rows: TimelineDisplayRow[] }): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {rows.map((row) => (
        <View key={row.id} style={[styles.item, row.role === "user" && styles.user]}>
          <Text style={styles.text}>{row.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  item: {
    alignSelf: "flex-start",
    maxWidth: "90%",
    backgroundColor: "#242428",
    borderRadius: 14,
    padding: 12,
  },
  list: { padding: 16, gap: 10 },
  text: { color: "#fafafa", lineHeight: 20 },
  user: { alignSelf: "flex-end", backgroundColor: "#0c4a6e" },
});
