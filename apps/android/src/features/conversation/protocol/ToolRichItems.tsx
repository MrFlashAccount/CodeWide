import { isProtocolRecord } from "./protocolValue";
import { renderToolImage } from "./toolImages";
/** V1 ToolContent owner, extracted without changing interaction or resource lifetime. */
import { Linking, Pressable, View } from "react-native";
import { isSafeHttpUrl } from "../../../rendering/http-link";
import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
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
    containsTerminalControlSequences,
    LazyJsonProtocolBody,
    maxHeight,
    ProtocolBody,
    ToolResourceLink,
    toolTextNeedsCodeViewport,
  }: {
    containsTerminalControlSequences: (value: string) => boolean;
    LazyJsonProtocolBody: ComponentType<LazyJsonBodyProps>;
    maxHeight: number;
    ProtocolBody: ComponentType<ProtocolBodyProps>;
    ToolResourceLink: ComponentType<ToolResourceLinkProps>;
    toolTextNeedsCodeViewport: (value: string) => boolean;
  },
) {
  const occurrences = new Map<string, number>();
  return (
    <View style={styles.protocolBody}>
      {items.map((raw, index) => {
        const key = occurrenceKey(occurrences, toolRichItemIdentity(raw));
        if (!isProtocolRecord(raw)) {
          return (
            <LazyJsonProtocolBody key={key} section={`${section}:${String(index)}`} value={raw} />
          );
        }
        const item = raw;
        const type = typeof item.type === "string" ? item.type : "unknown";
        if (type === "text" && typeof item.text === "string") {
          const terminal = containsTerminalControlSequences(item.text);
          return terminal || toolTextNeedsCodeViewport(item.text) ? (
            <ProtocolBody
              body={item.text}
              code
              collapsible
              expandedMaxHeight={maxHeight}
              key={key}
              section={`${section}:${String(index)}`}
              {...(terminal ? { codeVariant: "terminal" as const } : {})}
            />
          ) : (
            <View key={key} style={styles.toolMarkdownResult}>
              <RichMarkdown source={item.text} />
            </View>
          );
        }
        if ((type === "inputText" || type === "input_text") && typeof item.text === "string") {
          return (
            <ProtocolBody
              body={item.text}
              code
              collapsible
              expandedMaxHeight={maxHeight}
              key={key}
              section={`${section}:${String(index)}`}
            />
          );
        }
        const image = renderToolImage(item, type, index, key, getTransferAccess, (value) => (
          <LazyJsonProtocolBody key={key} section={`${section}:${String(index)}`} value={value} />
        ));
        if (image !== null) {
          return image;
        }
        if (type === "resource_link" && typeof item.uri === "string") {
          return (
            <ToolResourceLink
              key={key}
              label={
                typeof item.title === "string"
                  ? item.title
                  : typeof item.name === "string"
                    ? item.name
                    : "Resource"
              }
              uri={item.uri}
            />
          );
        }
        if (type === "resource") {
          const resource = recordValue(item.resource);
          if (typeof resource.text === "string") {
            return <RichMarkdown key={key} source={resource.text} />;
          }
          if (typeof resource.uri === "string") {
            return <ToolResourceLink key={key} label="Embedded resource" uri={resource.uri} />;
          }
        }
        if (type === "inputAudio" || type === "audio") {
          const uri = typeof item.audioUrl === "string" ? item.audioUrl : null;
          const canOpen = uri !== null && isSafeHttpUrl(uri);
          return (
            <Pressable
              disabled={!canOpen}
              key={key}
              onPress={canOpen ? () => void Linking.openURL(uri) : undefined}
              style={styles.attachmentChip}
            >
              <InlineIcon color={colors.textMuted} name="volume-medium-outline" role="label" />
              <Text numberOfLines={1} selectable style={styles.attachmentText}>
                {uri ?? "Audio output"}
              </Text>
            </Pressable>
          );
        }
        return (
          <LazyJsonProtocolBody key={key} section={`${section}:${String(index)}`} value={item} />
        );
      })}
    </View>
  );
}

function toolRichItemIdentity(value: unknown): string {
  if (!isProtocolRecord(value)) {
    return `${typeof value}:${textFingerprint(String(value))}`;
  }
  const type = typeof value.type === "string" ? value.type : "record";
  for (const field of [
    "id",
    "uri",
    "url",
    "imageUrl",
    "image_url",
    "text",
    "data",
    "name",
  ] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") {
      return `${type}:${field}:${textFingerprint(fieldValue)}`;
    }
  }
  const asset = recordValue(value.codewideAsset);
  return typeof asset.id === "string" ? `${type}:asset:${asset.id}` : type;
}
