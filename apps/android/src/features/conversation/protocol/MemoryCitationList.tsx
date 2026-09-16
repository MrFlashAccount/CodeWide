import { isProtocolRecord } from "./protocolValue";
/** V1 MemoryCitationList owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { occurrenceKey } from "../../../rendering/listKey";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./MemoryCitationList.styles";
import { numberValue, recordValue } from "./protocolValue";

export function MemoryCitationList({ value }: { value: unknown }) {
  const citation = recordValue(value);
  const entries = Array.isArray(citation.entries)
    ? citation.entries.flatMap((entry) => (isProtocolRecord(entry) ? [entry] : []))
    : [];
  if (entries.length === 0) {
    return null;
  }
  const occurrences = new Map<string, number>();
  return (
    <View style={styles.protocolBody}>
      <Text style={styles.controlSectionLabel}>Sources · {entries.length}</Text>
      {entries.map((entry, index) => {
        const path = typeof entry.path === "string" ? entry.path : `Source ${String(index + 1)}`;
        const lineStart = numberValue(entry.lineStart);
        const lineEnd = numberValue(entry.lineEnd);
        const lines =
          lineStart === null
            ? ""
            : lineEnd === null || lineEnd === lineStart
              ? `:${String(lineStart)}`
              : `:${String(lineStart)}–${String(lineEnd)}`;
        const key = occurrenceKey(
          occurrences,
          `${path}${lines}\u0000${typeof entry.note === "string" ? entry.note : ""}`,
        );
        return (
          <View key={key} style={styles.searchResult}>
            <Text ellipsizeMode="middle" numberOfLines={1} selectable style={styles.rawLink}>
              {path}
              {lines}
            </Text>
            {typeof entry.note === "string" && (
              <Text selectable style={styles.menuActionSubtitle}>
                {entry.note}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
