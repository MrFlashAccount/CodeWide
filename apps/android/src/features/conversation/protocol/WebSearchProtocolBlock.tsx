/** V1 WebSearchProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { Linking, Pressable } from "react-native";
import { isSafeHttpUrl } from "../../../rendering/http-link";
import { AppText as Text } from "../../../ui/Typography";
import { Card } from "../turns/Card";
import { protocolCopyText } from "./protocolCopyText";
import { LazyJsonProtocolBody } from "./ToolContent";
import { styles } from "./WebSearchProtocolBlock.styles";

export function WebSearchProtocolBlock({ block }: { block: RenderBlock }) {
  const query = typeof block.raw.query === "string" ? block.raw.query : "Search";
  return (
    <Card
      title={`Web search · ${query}`}
      icon="search-outline"
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <WebSearchProtocolDetails block={block} />
    </Card>
  );
}

function WebSearchProtocolDetails({ block }: { block: RenderBlock }) {
  const results = Array.isArray(block.raw.results)
    ? block.raw.results.filter(
        (result): result is Record<string, unknown> =>
          result !== null && typeof result === "object" && !Array.isArray(result),
      )
    : [];
  return (
    <>
      {results.length === 0 ? (
        <LazyJsonProtocolBody value={block.raw.action ?? block.raw} />
      ) : (
        results.map((result, index) => {
          const url =
            typeof result.url === "string" && isSafeHttpUrl(result.url) ? result.url : null;
          const title =
            typeof result.title === "string" ? result.title : (url ?? `Result ${index + 1}`);
          const snippet =
            typeof result.snippet === "string"
              ? result.snippet
              : typeof result.text === "string"
                ? result.text
                : null;
          return (
            <Pressable
              key={`${url ?? title}-${index}`}
              disabled={url === null}
              onPress={url === null ? undefined : () => void Linking.openURL(url)}
              style={styles.searchResult}
            >
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menuActionTitle}>
                {title}
              </Text>
              {snippet !== null && (
                <Text numberOfLines={3} style={styles.menuActionSubtitle}>
                  {snippet}
                </Text>
              )}
              {url !== null && (
                <Text numberOfLines={1} style={styles.rawLink}>
                  {url}
                </Text>
              )}
            </Pressable>
          );
        })
      )}
    </>
  );
}
