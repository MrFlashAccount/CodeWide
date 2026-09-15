/** V1 LiveAgentResponse owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { recordLiveRenderCommit } from "../../../data/operational-metrics";
import {
  projectCachedLiveText,
  type LiveMarkdownProjection,
} from "../../../rendering/live-text-stream";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { StreamingRevealSurface } from "../../../rendering/StreamingRevealSurface";
import { CommitOnChangeProbe } from "../../../ui/CommitProbe";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./LiveAgentResponse.styles";

export type LiveContentMode = "markdown" | "code";

export function StableLiveTextSegment({
  text,
  mode,
  streaming = false,
  animateStreaming = streaming,
}: {
  text: string;
  mode: LiveContentMode;
  streaming?: boolean;
  animateStreaming?: boolean;
}) {
  return mode === "markdown" ? (
    <RichMarkdown source={text} streaming={streaming} animateStreaming={animateStreaming} />
  ) : (
    <Text selectable style={styles.codeLine}>
      {text}
    </Text>
  );
}

export function AppendOnlyLiveContent({
  cacheKey,
  source,
  mode,
  streamMetricKey = null,
  markdownProjection,
  fill = false,
  animateNew = true,
}: {
  cacheKey: string;
  source: string;
  mode: LiveContentMode;
  streamMetricKey?: string | null;
  markdownProjection?: LiveMarkdownProjection;
  fill?: boolean;
  animateNew?: boolean;
}) {
  const singleMarkdownTree = mode === "markdown";
  const projection = markdownProjection ?? projectCachedLiveText(cacheKey, source);
  const visibleRemainder = markdownProjection?.visibleRemainder ?? projection.remainder;
  const visibleMarkdownSource = singleMarkdownTree
    ? (markdownProjection?.visibleSource ?? [...projection.segments, visibleRemainder].join(""))
    : "";
  return (
    <>
      <View
        testID={mode === "markdown" ? "live-agent-response" : "live-tool-output"}
        style={[
          styles.liveAgentResponse,
          (mode === "code" || fill) && styles.liveAgentResponseFill,
          mode === "markdown" && styles.liveMarkdownResponse,
        ]}
      >
        {singleMarkdownTree ? (
          visibleMarkdownSource === "" ? null : (
            <StreamingRevealSurface streamKey={cacheKey} animateNew={animateNew}>
              <StableLiveTextSegment
                text={visibleMarkdownSource}
                mode={mode}
                streaming
                animateStreaming={animateNew}
              />
            </StreamingRevealSurface>
          )
        ) : (
          <>
            {projection.segments.map((segment, index) => (
              <StableLiveTextSegment key={`${cacheKey}:${index}`} text={segment} mode={mode} />
            ))}
            {visibleRemainder !== "" && (
              <StableLiveTextSegment text={visibleRemainder} mode={mode} />
            )}
          </>
        )}
      </View>
      {streamMetricKey === null ? null : (
        <CommitOnChangeProbe
          scope={streamMetricKey}
          revision={source}
          onCommit={() => {
            if (source !== "") recordLiveRenderCommit(streamMetricKey);
          }}
        />
      )}
    </>
  );
}

export function LiveAgentResponse({
  cacheKey,
  fill,
  projection,
  streamMetricKey,
  animateNew,
}: {
  cacheKey: string;
  fill: boolean;
  projection: LiveMarkdownProjection;
  streamMetricKey: string | null;
  animateNew: boolean;
}) {
  return (
    <AppendOnlyLiveContent
      cacheKey={cacheKey}
      source={projection.source}
      mode="markdown"
      streamMetricKey={streamMetricKey}
      markdownProjection={projection}
      fill={fill}
      animateNew={animateNew}
    />
  );
}
