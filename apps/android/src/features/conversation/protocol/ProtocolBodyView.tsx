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
  activeToolCall,
  body,
  bodyLines,
  canCollapse,
  code,
  codeVariant,
  collapsedLines,
  expanded,
  expandedMaxHeight,
  itemKey,
  language,
  maxHeight,
  rendered,
  section,
  setExpanded,
  showCopyAction,
}: Required<
  Pick<
    ProtocolBodyProps,
    "body" | "code" | "section" | "language" | "codeVariant" | "showCopyAction"
  >
> & {
  activeToolCall: boolean;
  bodyLines: number;
  canCollapse: boolean;
  collapsedLines: number;
  expanded: boolean;
  expandedMaxHeight: number | undefined;
  itemKey: string;
  maxHeight: number;
  rendered: string;
  setExpanded: Dispatch<SetStateAction<boolean>>;
}) {
  const content = code ? (
    <NativeCodeBlock
      fillAvailableWidth
      language={language}
      maxHeight={expandedMaxHeight ?? maxHeight}
      value={rendered}
      variant={codeVariant}
      {...(!expanded && canCollapse ? { maxVisibleLines: collapsedLines } : {})}
    />
  ) : activeToolCall && (expanded || !canCollapse) ? (
    <AppendOnlyLiveContent cacheKey={`${itemKey}:${section}`} mode="markdown" source={rendered} />
  ) : (
    <Text
      numberOfLines={!expanded && canCollapse ? collapsedLines : undefined}
      selectable
      style={styles.agentText}
    >
      {rendered}
    </Text>
  );
  return (
    <View style={styles.protocolBody}>
      {!code && expanded && expandedMaxHeight !== undefined ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 0 }}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ flexGrow: 0, flexShrink: 1, maxHeight: expandedMaxHeight }}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {canCollapse && (
        <View style={styles.protocolBodyActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setExpanded((value) => !value);
            }}
          >
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
