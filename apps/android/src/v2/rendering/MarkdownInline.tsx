import type { PhrasingContent } from "mdast";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { colors, typeScale, typeWeight } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { MarkdownLink } from "./MarkdownLink";
import { markdownNodeKey } from "./richMarkdownModel";

export function renderMarkdownInline(nodes: PhrasingContent[]): ReactNode[] {
  return nodes.map((node) => {
    const key = markdownNodeKey(node, "inline");
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {renderMarkdownInline(node.children)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={styles.emphasis}>
            {renderMarkdownInline(node.children)}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={styles.deleted}>
            {renderMarkdownInline(node.children)}
          </Text>
        );
      case "inlineCode":
        return (
          <Text key={key} selectable style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case "break":
        return "\n";
      case "link":
        return (
          <MarkdownLink key={key} url={node.url}>
            {renderMarkdownInline(node.children)}
          </MarkdownLink>
        );
      case "image":
        return (
          <Text key={key} style={styles.secondary}>
            [Image: {node.alt ?? node.url}]
          </Text>
        );
      case "footnoteReference":
        return (
          <Text key={key} style={styles.secondary}>
            [{node.identifier}]
          </Text>
        );
      case "linkReference":
        return <Text key={key}>{renderMarkdownInline(node.children)}</Text>;
      case "imageReference":
        return (
          <Text key={key} style={styles.secondary}>
            [Image: {node.alt ?? node.identifier}]
          </Text>
        );
      case "html":
        return (
          <Text key={key} selectable style={styles.rawHtml}>
            {node.value}
          </Text>
        );
      default:
        return null;
    }
  });
}

const styles = StyleSheet.create({
  deleted: { color: colors.textMuted, textDecorationLine: "line-through" },
  emphasis: { fontStyle: "italic" },
  inlineCode: { backgroundColor: colors.code, color: colors.text, ...typeScale.code },
  rawHtml: { color: colors.textMuted, ...typeScale.code },
  secondary: { color: colors.textMuted },
  strong: { fontWeight: typeWeight.semibold },
});
