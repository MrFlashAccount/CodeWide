/** V1 LiveAgentResponse owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { recordLiveRenderCommit } from "../../../data/operational-metrics";
import {
  projectCachedLiveText,
  type LiveMarkdownProjection,
} from "../../../rendering/live-text-stream";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
import { StreamingRevealSurface } from "../../../rendering/StreamingRevealSurface";
import { CommitOnChangeProbe } from "../../../ui/CommitProbe";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./LiveAgentResponse.styles";

export type LiveContentMode = "markdown" | "code";

export function StableLiveTextSegment({
  streaming = false,
  animateStreaming = streaming,
  mode,
  text,
}: {
  animateStreaming?: boolean;
  mode: LiveContentMode;
  streaming?: boolean;
  text: string;
}) {
  return mode === "markdown" ? (
    <RichMarkdown animateStreaming={animateStreaming} source={text} streaming={streaming} />
  ) : (
    <Text selectable style={styles.codeLine}>
      {text}
    </Text>
  );
}

export function AppendOnlyLiveContent({
  animateNew = true,
  cacheKey,
  fill = false,
  markdownProjection,
  mode,
  source,
  streamMetricKey = null,
}: {
  animateNew?: boolean;
  cacheKey: string;
  fill?: boolean;
  markdownProjection?: LiveMarkdownProjection;
  mode: LiveContentMode;
  source: string;
  streamMetricKey?: string | null;
}) {
  const singleMarkdownTree = mode === "markdown";
  const projection = markdownProjection ?? projectCachedLiveText(cacheKey, source);
  const visibleRemainder = markdownProjection?.visibleRemainder ?? projection.remainder;
  const visibleMarkdownSource = singleMarkdownTree
    ? (markdownProjection?.visibleSource ?? [...projection.segments, visibleRemainder].join(""))
    : "";
  const segmentOccurrences = new Map<string, number>();
  return (
    <>
      <View
        style={[
          styles.liveAgentResponse,
          (mode === "code" || fill) && styles.liveAgentResponseFill,
          mode === "markdown" && styles.liveMarkdownResponse,
        ]}
        testID={mode === "markdown" ? "live-agent-response" : "live-tool-output"}
      >
        {singleMarkdownTree ? (
          visibleMarkdownSource === "" ? null : (
            <StreamingRevealSurface animateNew={animateNew} streamKey={cacheKey}>
              <StableLiveTextSegment
                animateStreaming={animateNew}
                mode={mode}
                streaming
                text={visibleMarkdownSource}
              />
            </StreamingRevealSurface>
          )
        ) : (
          <>
            {projection.segments.map((segment) => {
              const key = occurrenceKey(
                segmentOccurrences,
                `${cacheKey}:${textFingerprint(segment)}`,
              );
              return <StableLiveTextSegment key={key} mode={mode} text={segment} />;
            })}
            {visibleRemainder !== "" && (
              <StableLiveTextSegment mode={mode} text={visibleRemainder} />
            )}
          </>
        )}
      </View>
      {streamMetricKey === null ? null : (
        <CommitOnChangeProbe
          onCommit={() => {
            if (source !== "") {
              recordLiveRenderCommit(streamMetricKey);
            }
          }}
          revision={source}
          scope={streamMetricKey}
        />
      )}
    </>
  );
}

export function LiveAgentResponse({
  animateNew,
  cacheKey,
  fill,
  projection,
  streamMetricKey,
}: {
  animateNew: boolean;
  cacheKey: string;
  fill: boolean;
  projection: LiveMarkdownProjection;
  streamMetricKey: string | null;
}) {
  return (
    <AppendOnlyLiveContent
      animateNew={animateNew}
      cacheKey={cacheKey}
      fill={fill}
      markdownProjection={projection}
      mode="markdown"
      source={projection.source}
      streamMetricKey={streamMetricKey}
    />
  );
}
