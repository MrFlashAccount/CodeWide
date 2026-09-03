import type { RootContent } from "mdast";
import { View } from "react-native";

import { PresentationText as Text } from "../presentation/text/ProductText";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownCodeNode } from "./MarkdownCodeNode";
import { renderMarkdownInline } from "./MarkdownInline";
import { MarkdownTable } from "./MarkdownTable";
import { ReviewableText } from "./ReviewableText";
import { fallbackText, githubAlert, markdownNodeKey, plainInlineText } from "./richMarkdownModel";
import { markdownHeadingStyle, markdownNodeStyles as styles } from "./markdownNodeStyles";
import type { MarkdownImageReference } from "./renderingCapabilities";
import type { RichExtensionRenderer } from "./richExtensionRenderer";

export interface MarkdownNodeProps {
  extensions: Record<string, RichExtensionRenderer>;
  images: MarkdownImageReference[];
  node: RootContent;
  path: string;
  reviewTargetId?: string;
}

export function MarkdownNode(props: MarkdownNodeProps): React.JSX.Element | null {
  const { extensions, images, node, path, reviewTargetId } = props;
  switch (node.type) {
    case "paragraph": {
      const single = node.children.length === 1 ? node.children[0] : undefined;
      if (single?.type === "image") {
        return <MarkdownImage references={images} selectedId={markdownNodeKey(single, "image")} />;
      }
      if (
        single?.type === "link" &&
        single.children.length === 1 &&
        single.children[0]?.type === "image"
      ) {
        const image = single.children[0];
        return <MarkdownImage references={images} selectedId={markdownNodeKey(image, "image")} />;
      }
      const value = plainInlineText(node.children);
      return (
        <ReviewableText
          reviewBlockPath={path}
          reviewValue={value}
          style={styles.paragraph}
          {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
        >
          {renderMarkdownInline(node.children)}
        </ReviewableText>
      );
    }
    case "heading": {
      const value = plainInlineText(node.children);
      return (
        <ReviewableText
          reviewBlockPath={path}
          reviewValue={value}
          style={[styles.heading, markdownHeadingStyle(node.depth)]}
          {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
        >
          {renderMarkdownInline(node.children)}
        </ReviewableText>
      );
    }
    case "blockquote":
      return <MarkdownQuote {...props} />;
    case "list":
      return (
        <View style={styles.list}>
          {node.children.map((item, index) => {
            const itemPath = markdownNodeKey(item, `${path}-item`);
            return (
              <View key={itemPath} style={styles.listRow}>
                <Text style={styles.listMarker}>
                  {typeof item.checked === "boolean"
                    ? item.checked
                      ? "☑"
                      : "☐"
                    : node.ordered === true
                      ? `${(node.start ?? 1) + index}.`
                      : "•"}
                </Text>
                <View style={styles.listBody}>
                  {item.children.map((child) => (
                    <MarkdownNode
                      key={markdownNodeKey(child, itemPath)}
                      {...props}
                      node={child}
                      path={markdownNodeKey(child, itemPath)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      );
    case "code":
      return (
        <MarkdownCodeNode
          extensions={extensions}
          node={node}
          path={path}
          {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
        />
      );
    case "table":
      return <MarkdownTable table={node} />;
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "html":
      return (
        <Text selectable style={styles.rawHtml}>
          {node.value}
        </Text>
      );
    case "footnoteDefinition":
      return (
        <View style={styles.footnote}>
          <Text style={styles.footnoteMarker}>[{node.identifier}]</Text>
          <View style={styles.footnoteBody}>
            {node.children.map((child) => (
              <MarkdownNode
                key={markdownNodeKey(child, `${path}-footnote`)}
                {...props}
                node={child}
                path={markdownNodeKey(child, `${path}-footnote`)}
              />
            ))}
          </View>
        </View>
      );
    case "definition":
    case "yaml":
      return null;
    case "break":
    case "delete":
    case "emphasis":
    case "footnoteReference":
    case "image":
    case "imageReference":
    case "inlineCode":
    case "link":
    case "linkReference":
    case "listItem":
    case "strong":
    case "tableCell":
    case "tableRow":
    case "text":
      return (
        <Text selectable style={styles.secondary}>
          {fallbackText(node)}
        </Text>
      );
    default:
      return unreachableMarkdownNode(node);
  }
}

function unreachableMarkdownNode(_node: never): null {
  return null;
}

function MarkdownQuote(props: MarkdownNodeProps): React.JSX.Element {
  const { node, path } = props;
  if (node.type !== "blockquote") return <View />;
  const alert = githubAlert(node);
  const children = alert?.children ?? node.children;
  return (
    <View style={alert === null ? styles.blockquote : styles.alert}>
      {alert === null ? null : (
        <Text style={[styles.alertTitle, { color: alert.color }]}>{alert.label}</Text>
      )}
      {children.map((child) => (
        <MarkdownNode
          key={markdownNodeKey(child, `${path}-quote`)}
          {...props}
          node={child}
          path={markdownNodeKey(child, `${path}-quote`)}
        />
      ))}
    </View>
  );
}
