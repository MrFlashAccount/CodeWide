import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { occurrenceKey } from "../../rendering/listKey";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { styles } from "./GlobalSearchScreen.styles";
import type { SearchResultTarget, ServerSearchResult } from "./searchResultTypes";

export interface ServerNoticeProps {
  readonly name: string;
  readonly result: ServerSearchResult;
}

export function SearchServerNotice(props: ServerNoticeProps) {
  const result = props.result;
  if (result.status === "error") {
    return (
      <Text style={styles.error}>
        {props.name}: {result.message}
      </Text>
    );
  }
  if (result.page.failedSources > 0) {
    return (
      <View style={styles.partialNotice}>
        <Ionicons
          accessible={false}
          color={colors.textMuted}
          name="information-circle-outline"
          size={iconSize.inline}
        />
        <Text
          accessibilityLabel={`${props.name}: Results are incomplete. ${String(result.page.failedSources)} chat histories could not be indexed.`}
          numberOfLines={1}
          style={styles.partialNoticeText}
        >
          {props.name} · {result.page.failedSources}{" "}
          {result.page.failedSources === 1 ? "chat" : "chats"} not indexed
        </Text>
      </View>
    );
  }
  return result.page.indexing ? (
    <WaveText
      style={styles.notice}
      text={`${props.name}: indexing history · results are incomplete`}
    />
  ) : null;
}

export interface ResultProps {
  readonly onSelect: (hit: SearchResultTarget) => void;
  readonly query: string;
  readonly target: SearchResultTarget;
}

export function SearchResultRow(props: ResultProps) {
  const select = useEvent(() => {
    props.onSelect(props.target);
  });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={select}
      style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}
      testID="search-result-row"
    >
      <View style={styles.resultHeading}>
        <Text numberOfLines={1} style={styles.resultTitle}>
          {props.target.hit.title.trim() === "" ? "Untitled chat" : props.target.hit.title}
        </Text>
        <Text numberOfLines={1} style={styles.caption}>
          {formatSearchTimestamp(props.target.hit.timestamp)}
        </Text>
      </View>
      <SearchHighlightedText query={props.query} text={props.target.hit.excerpt} />
    </Pressable>
  );
}

function formatSearchTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "";
}

interface HighlightProps {
  readonly query: string;
  readonly text: string;
}

function SearchHighlightedText(props: HighlightProps) {
  const tokens = props.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const occurrences = new Map<string, number>();
  return (
    <Text numberOfLines={2} style={styles.resultExcerpt}>
      {props.text.split(/(\s+)/u).map((part) => {
        const key = occurrenceKey(occurrences, part);
        return (
          <Text
            key={key}
            style={
              tokens.length > 0 && tokens.some((token) => part.toLocaleLowerCase().includes(token))
                ? styles.highlight
                : undefined
            }
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

export function resultKey(result: SearchResultTarget): string {
  return `${result.connectionId}:${String(result.hit.messageId)}`;
}
