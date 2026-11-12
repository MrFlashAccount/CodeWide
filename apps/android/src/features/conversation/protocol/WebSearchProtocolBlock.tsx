/** V1 WebSearchProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import type { ReactElement } from "react";
import { Linking, Pressable, View } from "react-native";
import { occurrenceKey } from "../../../rendering/listKey";
import { useEvent } from "../../../react/useEvent";
import { AppText as Text } from "../../../ui/Typography";
import { Card } from "../turns/Card";
import { protocolCopyText } from "./protocolCopyText";
import { LazyJsonProtocolBody } from "./ToolContent";
import { styles } from "./WebSearchProtocolBlock.styles";
import { webSearchResults, webSearchSummary, type WebSearchResult } from "./webSearchPresentation";

const RESULT_NUMBER_DIGITS = 2;

export function WebSearchProtocolBlock({ block }: { block: RenderBlock }): ReactElement {
  const { query } = webSearchSummary(block);
  return (
    <Card
      copyText={() => protocolCopyText(block)}
      detailSheetEnabled
      icon="search-outline"
      title={`Web search · ${query}`}
    >
      <WebSearchProtocolDetails block={block} />
    </Card>
  );
}

function WebSearchProtocolDetails({ block }: { block: RenderBlock }) {
  const results = webSearchResults(block);
  const occurrences = new Map<string, number>();
  return results.length === 0 ? (
    <LazyJsonProtocolBody value={block.raw.action ?? block.raw} />
  ) : (
    results.map((result, index) => (
      <WebSearchResultRow
        index={index}
        key={occurrenceKey(occurrences, result.key)}
        result={result}
      />
    ))
  );
}

function WebSearchResultRow({ index, result }: { index: number; result: WebSearchResult }) {
  const open = useEvent(() => {
    if (result.url !== null) {
      Linking.openURL(result.url).catch(() => undefined);
    }
  });
  const label =
    result.url === null
      ? undefined
      : `Open ${result.title}${result.domain === null ? "" : ` from ${result.domain}`}`;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={result.url === null ? undefined : "link"}
      disabled={result.url === null}
      onPress={result.url === null ? undefined : open}
      style={styles.searchResult}
      testID="web-search-result"
    >
      <Text style={styles.resultIndex}>
        {String(index + 1).padStart(RESULT_NUMBER_DIGITS, "0")}
      </Text>
      <View style={styles.resultContent}>
        {result.domain !== null && (
          <Text numberOfLines={1} style={styles.resultDomain}>
            {result.domain}
          </Text>
        )}
        <Text ellipsizeMode="tail" numberOfLines={2} style={styles.resultTitle}>
          {result.title}
        </Text>
        {result.snippet !== null && (
          <Text numberOfLines={2} style={styles.resultSnippet}>
            {result.snippet}
          </Text>
        )}
      </View>
      {result.url !== null && (
        <View style={styles.openIcon}>
          <Text accessible={false} style={styles.openIconText}>
            ↗
          </Text>
        </View>
      )}
    </Pressable>
  );
}
