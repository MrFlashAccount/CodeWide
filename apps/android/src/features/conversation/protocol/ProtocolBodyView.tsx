/** V1 ToolContent owner, extracted without changing interaction or resource lifetime. */
import { Pressable, ScrollView, View } from "react-native";
import { NativeCodeBlock } from "../../../rendering/NativeCodeBlock";
import { AppText as Text } from "../../../ui/Typography";
import { EXPANDED_BODY_CHARS } from "../content/contentLimits";
import { AppendOnlyLiveContent } from "../turns/LiveAgentResponse";
import { CopyButton } from "../turns/MessageActionRail";
import { styles } from "./ToolContent.styles";

import type { Dispatch, SetStateAction } from "react";
import type { ProtocolBodyProps } from "./ToolContent.types";
/** Bounded protocol presentation keeps expansion state and projection with ProtocolBody. */
export function renderProtocolBodyView({
  body,
  code,
  expandedMaxHeight,
  section,
  language,
  codeVariant,
  showCopyAction,
  rendered,
  expanded,
  canCollapse,
  collapsedLines,
  activeToolCall,
  itemKey,
  bodyLines,
  setExpanded,
  maxHeight,
}: Required<
  Pick<
    ProtocolBodyProps,
    "body" | "code" | "section" | "language" | "codeVariant" | "showCopyAction"
  >
> & {
  expandedMaxHeight: number | undefined;
  rendered: string;
  expanded: boolean;
  canCollapse: boolean;
  collapsedLines: number;
  activeToolCall: boolean;
  itemKey: string;
  bodyLines: number;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  maxHeight: number;
}) {
  const content = code ? (
    <NativeCodeBlock
      value={rendered}
      language={language}
      variant={codeVariant}
      maxHeight={expandedMaxHeight ?? maxHeight}
      fillAvailableWidth
      {...(!expanded && canCollapse ? { maxVisibleLines: collapsedLines } : {})}
    />
  ) : activeToolCall && (expanded || !canCollapse) ? (
    <AppendOnlyLiveContent cacheKey={`${itemKey}:${section}`} source={rendered} mode="markdown" />
  ) : (
    <Text
      selectable
      numberOfLines={!expanded && canCollapse ? collapsedLines : undefined}
      style={styles.agentText}
    >
      {rendered}
    </Text>
  );
  return (
    <View style={styles.protocolBody}>
      {!code && expanded && expandedMaxHeight !== undefined ? (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ maxHeight: expandedMaxHeight, flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ flexGrow: 0 }}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {canCollapse && (
        <View style={styles.protocolBodyActions}>
          <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
            <Text style={styles.rawLink}>
              {expanded
                ? "Show less"
                : `Show more · ${bodyLines.toLocaleString()} ${bodyLines === 1 ? "line" : "lines"}`}
            </Text>
          </Pressable>
          {showCopyAction && <CopyButton text={body} />}
        </View>
      )}
      {expanded && body.length > EXPANDED_BODY_CHARS && (
        <Text style={styles.menuNotice}>
          Rendering is capped for stability; Copy preserves the complete output.
        </Text>
      )}
    </View>
  );
}
