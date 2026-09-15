import { isProtocolRecord } from "./protocolValue";
import { renderToolImage } from "./toolImages";
/** V1 ToolContent owner, extracted without changing interaction or resource lifetime. */
import { Linking, Pressable, View } from "react-native";
import { isSafeHttpUrl } from "../../../rendering/http-link";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { recordValue } from "./protocolValue";
import { styles } from "./ToolContent.styles";

import type { ComponentType } from "react";
import type {
  LazyJsonBodyProps,
  ProtocolBodyProps,
  ToolContentProps,
  ToolResourceLinkProps,
} from "./ToolContent.types";
/** Ordered protocol rich items delegate bounded text, JSON and links to the coupled tool owner. */
export function renderToolRichItems(
  items: unknown[],
  section: string,
  getTransferAccess: ToolContentProps["getTransferAccess"],
  {
    ProtocolBody,
    LazyJsonProtocolBody,
    ToolResourceLink,
    toolTextNeedsCodeViewport,
    containsTerminalControlSequences,
    maxHeight,
  }: {
    ProtocolBody: ComponentType<ProtocolBodyProps>;
    LazyJsonProtocolBody: ComponentType<LazyJsonBodyProps>;
    ToolResourceLink: ComponentType<ToolResourceLinkProps>;
    toolTextNeedsCodeViewport(value: string): boolean;
    containsTerminalControlSequences(value: string): boolean;
    maxHeight: number;
  },
) {
  return (
    <View style={styles.protocolBody}>
      {items.map((raw, index) => {
        if (!isProtocolRecord(raw))
          return <LazyJsonProtocolBody key={index} value={raw} section={`${section}:${index}`} />;
        const item = raw;
        const type = typeof item.type === "string" ? item.type : "unknown";
        if (type === "text" && typeof item.text === "string") {
          const terminal = containsTerminalControlSequences(item.text);
          return terminal || toolTextNeedsCodeViewport(item.text) ? (
            <ProtocolBody
              key={index}
              body={item.text}
              code
              collapsible
              expandedMaxHeight={maxHeight}
              section={`${section}:${index}`}
              {...(terminal ? { codeVariant: "terminal" as const } : {})}
            />
          ) : (
            <View key={index} style={styles.toolMarkdownResult}>
              <RichMarkdown source={item.text} />
            </View>
          );
        }
        if ((type === "inputText" || type === "input_text") && typeof item.text === "string")
          return (
            <ProtocolBody
              key={index}
              body={item.text}
              code
              collapsible
              expandedMaxHeight={maxHeight}
              section={`${section}:${index}`}
            />
          );
        const image = renderToolImage(item, type, index, getTransferAccess, (value) => (
          <LazyJsonProtocolBody key={index} value={value} section={`${section}:${index}`} />
        ));
        if (image !== null) return image;
        if (type === "resource_link" && typeof item.uri === "string")
          return (
            <ToolResourceLink
              key={index}
              uri={item.uri}
              label={
                typeof item.title === "string"
                  ? item.title
                  : typeof item.name === "string"
                    ? item.name
                    : "Resource"
              }
            />
          );
        if (type === "resource") {
          const resource = recordValue(item.resource);
          if (typeof resource.text === "string")
            return <RichMarkdown key={index} source={resource.text} />;
          if (typeof resource.uri === "string")
            return <ToolResourceLink key={index} uri={resource.uri} label="Embedded resource" />;
        }
        if (type === "inputAudio" || type === "audio") {
          const uri = typeof item.audioUrl === "string" ? item.audioUrl : null;
          const canOpen = uri !== null && isSafeHttpUrl(uri);
          return (
            <Pressable
              key={index}
              disabled={!canOpen}
              onPress={canOpen ? () => void Linking.openURL(uri) : undefined}
              style={styles.attachmentChip}
            >
              <InlineIcon name="volume-medium-outline" role="label" color={colors.textMuted} />
              <Text selectable numberOfLines={1} style={styles.attachmentText}>
                {uri ?? "Audio output"}
              </Text>
            </Pressable>
          );
        }
        return <LazyJsonProtocolBody key={index} value={item} section={`${section}:${index}`} />;
      })}
    </View>
  );
}
