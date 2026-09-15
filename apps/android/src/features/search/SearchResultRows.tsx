import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { styles } from "./GlobalSearchScreen.styles";
import type { SearchResultTarget, ServerSearchResult } from "./searchResultTypes";

export interface ServerNoticeProps {
  readonly result: ServerSearchResult;
  readonly name: string;
}

export function SearchServerNotice(props: ServerNoticeProps) {
  const result = props.result;
  if (result.status === "error")
    return (
      <Text style={styles.error}>
        {props.name}: {result.message}
      </Text>
    );
  if (result.page.failedSources > 0)
    return (
      <View style={styles.partialNotice}>
        <Ionicons
          name="information-circle-outline"
          size={iconSize.inline}
          color={colors.textMuted}
          accessible={false}
        />
        <Text
          numberOfLines={1}
          style={styles.partialNoticeText}
          accessibilityLabel={`${props.name}: Results are incomplete. ${result.page.failedSources} chat histories could not be indexed.`}
        >
          {props.name} · {result.page.failedSources}{" "}
          {result.page.failedSources === 1 ? "chat" : "chats"} not indexed
        </Text>
      </View>
    );
  return result.page.indexing ? (
    <WaveText
      text={`${props.name}: indexing history · results are incomplete`}
      style={styles.notice}
    />
  ) : null;
}

export interface ResultProps {
  readonly target: SearchResultTarget;
  readonly query: string;
  readonly onSelect: (hit: SearchResultTarget) => void;
}

export function SearchResultRow(props: ResultProps) {
  const select = useEvent(() => props.onSelect(props.target));
  return (
    <Pressable onPress={select} style={styles.result} accessibilityRole="button">
      <View style={styles.resultHeading}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {props.target.hit.title || props.target.hit.threadId}
        </Text>
        <Text style={styles.caption}>{formatSearchTimestamp(props.target.hit.timestamp)}</Text>
      </View>
      <SearchHighlightedText text={props.target.hit.excerpt} query={props.query} />
    </Pressable>
  );
}

function formatSearchTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
}

interface HighlightProps {
  readonly text: string;
  readonly query: string;
}

function SearchHighlightedText(props: HighlightProps) {
  const tokens = props.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return (
    <Text style={styles.label} numberOfLines={3}>
      {props.text.split(/(\s+)/u).map((part, index) => (
        <Text
          key={index}
          style={
            tokens.length > 0 && tokens.some((token) => part.toLocaleLowerCase().includes(token))
              ? styles.highlight
              : undefined
          }
        >
          {part}
        </Text>
      ))}
    </Text>
  );
}

export function resultKey(result: SearchResultTarget): string {
  return `${result.connectionId}:${result.hit.messageId}`;
}
