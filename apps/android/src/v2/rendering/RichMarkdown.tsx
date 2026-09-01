import { isSafeLink, parseRichMarkdown, plainRichMarkdownRootText } from "@codewide/rendering-core";
import { Ionicons } from "@expo/vector-icons";
import { setStringAsync } from "expo-clipboard";
import type { Nodes, PhrasingContent, RootContent, Table, TableCell } from "mdast";
import { useRef, useState, type ReactNode } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
} from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";

interface RichMarkdownProps {
  maxLines?: number;
  source: string;
}

interface BlockNodeProps {
  node: RootContent;
  path: string;
}

interface CopyableCodeBlockProps {
  language: string;
  value: string;
}

interface MarkdownLinkProps {
  children: ReactNode;
  url: string;
}

interface MarkdownImageProps {
  alt: string;
  url: string;
}

interface MarkdownTableProps {
  table: Table;
}

interface TableCellViewProps {
  align: "center" | "left" | "right" | null;
  cell: TableCell;
  header: boolean;
  width: number;
}

const TABLE_CELL_WIDTH = 144;

export function RichMarkdown(props: RichMarkdownProps): React.JSX.Element {
  const { maxLines, source } = props;
  const parsed = parseRichMarkdown(source);
  if (maxLines !== undefined) {
    return (
      <Text ellipsizeMode="tail" numberOfLines={maxLines} selectable style={styles.paragraph}>
        {plainRichMarkdownRootText(parsed.root)}
      </Text>
    );
  }
  return (
    <View style={styles.document}>
      {parsed.root.children.map((node) => {
        const key = markdownNodeKey(node, "root");
        return <BlockNode key={key} node={node} path={key} />;
      })}
      {parsed.truncated ? (
        <View style={styles.truncated}>
          <Text style={styles.secondary}>
            Large message preview · {parsed.originalLength.toLocaleString()} characters
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function BlockNode(props: BlockNodeProps): React.JSX.Element | null {
  const { node, path } = props;
  switch (node.type) {
    case "paragraph": {
      const child = node.children[0];
      if (node.children.length === 1 && child?.type === "image") {
        return <MarkdownImage alt={child.alt ?? "Image"} url={child.url} />;
      }
      return (
        <Text selectable style={styles.paragraph}>
          {inline(node.children)}
        </Text>
      );
    }
    case "heading":
      return (
        <Text selectable style={[styles.heading, headingStyle(node.depth)]}>
          {inline(node.children)}
        </Text>
      );
    case "blockquote":
      return (
        <View style={styles.blockquote}>
          {node.children.map((child) => {
            const childPath = markdownNodeKey(child, `${path}-quote`);
            return <BlockNode key={childPath} node={child} path={childPath} />;
          })}
        </View>
      );
    case "list":
      return (
        <View style={styles.list}>
          {node.children.map((item, index) => {
            const itemPath = markdownNodeKey(item, `${path}-item`);
            return (
              <View key={itemPath} style={styles.listRow}>
                {typeof item.checked === "boolean" ? (
                  <View
                    accessibilityLabel={item.checked ? "Completed task" : "Open task"}
                    style={styles.taskMarker}
                  >
                    <Ionicons
                      color={item.checked ? colors.green : colors.textMuted}
                      name={item.checked ? "checkbox" : "square-outline"}
                      size={15}
                    />
                  </View>
                ) : (
                  <Text style={styles.listMarker}>
                    {node.ordered === true ? `${(node.start ?? 1) + index}.` : "•"}
                  </Text>
                )}
                <View style={styles.listBody}>
                  {item.children.map((child) => {
                    const childPath = markdownNodeKey(child, itemPath);
                    return <BlockNode key={childPath} node={child} path={childPath} />;
                  })}
                </View>
              </View>
            );
          })}
        </View>
      );
    case "code":
      return <CopyableCodeBlock language={node.lang ?? "text"} value={node.value} />;
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
          <Text selectable style={styles.footnoteMarker}>
            [{node.identifier}]
          </Text>
          <View style={styles.footnoteBody}>
            {node.children.map((child) => {
              const childPath = markdownNodeKey(child, `${path}-footnote`);
              return <BlockNode key={childPath} node={child} path={childPath} />;
            })}
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
      return null;
  }
}

function CopyableCodeBlock(props: CopyableCodeBlockProps): React.JSX.Element {
  const { language, value } = props;
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useEvent(() => {
    void setStringAsync(value).catch(() => undefined);
    setCopied(true);
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      setCopied(false);
    }, 900);
  });
  return (
    <Pressable
      accessibilityLabel={`Copy ${language} code block`}
      accessibilityRole="button"
      onPress={copy}
      style={styles.codeContainer}
    >
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language}</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.copyHint, copied && styles.copyHintDone]}
        >
          {copied ? "Copied" : "Tap to copy"}
        </Text>
      </View>
      <ScrollView horizontal nestedScrollEnabled style={styles.codeScroll}>
        <Text selectable style={styles.codeText}>
          {value}
        </Text>
      </ScrollView>
    </Pressable>
  );
}

function MarkdownLink(props: MarkdownLinkProps): React.JSX.Element {
  const { children, url } = props;
  const open = useEvent(() => {
    if (isSafeLink(url)) void Linking.openURL(url).catch(() => undefined);
  });
  if (!isSafeLink(url)) return <Text style={styles.secondary}>{children}</Text>;
  return (
    <Text
      accessibilityHint="Opens the link"
      accessibilityRole="link"
      onPress={open}
      style={styles.link}
    >
      {children} <Ionicons color={colors.accent} name="open-outline" size={11} />
    </Text>
  );
}

function MarkdownImage(props: MarkdownImageProps): React.JSX.Element {
  const { alt, url } = props;
  if (!isSafeLink(url)) {
    return (
      <Text selectable style={styles.secondary}>
        [Image: {alt}]
      </Text>
    );
  }
  return (
    <Image
      accessibilityLabel={alt}
      resizeMode="contain"
      source={{ uri: url }}
      style={styles.image}
    />
  );
}

function MarkdownTable(props: MarkdownTableProps): React.JSX.Element {
  const { table } = props;
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={styles.tableViewport}
    >
      <View style={[styles.table, { width: TABLE_CELL_WIDTH * columnCount }]}>
        {table.children.map((row, rowIndex) => (
          <View
            key={markdownNodeKey(row, "table-row")}
            style={[styles.tableRow, rowIndex === 0 && styles.tableHeader]}
          >
            {row.children.map((cell, cellIndex) => (
              <TableCellView
                key={markdownNodeKey(cell, "table-cell")}
                align={table.align?.[cellIndex] ?? null}
                cell={cell}
                header={rowIndex === 0}
                width={TABLE_CELL_WIDTH}
              />
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function TableCellView(props: TableCellViewProps): React.JSX.Element {
  const { align, cell, header, width } = props;
  return (
    <Text
      style={[
        styles.tableCell,
        header && styles.tableCellHeader,
        { textAlign: align ?? "left", width },
      ]}
    >
      {inline(cell.children)}
    </Text>
  );
}

function inline(nodes: PhrasingContent[]): ReactNode[] {
  return nodes.map((node) => {
    const key = markdownNodeKey(node, "inline");
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {inline(node.children)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={styles.emphasis}>
            {inline(node.children)}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={styles.deleted}>
            {inline(node.children)}
          </Text>
        );
      case "inlineCode":
        return (
          <Text key={key} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case "break":
        return "\n";
      case "link":
        return (
          <MarkdownLink key={key} url={node.url}>
            {inline(node.children)}
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
        return <Text key={key}>{inline(node.children)}</Text>;
      case "imageReference":
        return (
          <Text key={key} style={styles.secondary}>
            [Image: {node.alt ?? node.identifier}]
          </Text>
        );
      case "html":
        return (
          <Text key={key} style={styles.rawHtml}>
            {node.value}
          </Text>
        );
      default:
        return <Text key={key}>{fallbackText(node)}</Text>;
    }
  });
}

function headingStyle(depth: 1 | 2 | 3 | 4 | 5 | 6): TextStyle {
  if (depth === 1) return styles.headingOne;
  if (depth === 2) return styles.headingTwo;
  if (depth === 3) return styles.headingThree;
  return styles.headingMinor;
}

function markdownNodeKey(node: Nodes, prefix: string): string {
  const offset = node.position?.start.offset;
  if (offset !== undefined) return `${prefix}:${node.type}:${offset}`;
  return `${prefix}:${node.type}:${fallbackText(node)}`;
}

function fallbackText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return `[${node.type}]`;
}

const styles = StyleSheet.create({
  blockquote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 2,
    gap: spacing.xxs,
    paddingLeft: spacing.xs,
  },
  codeContainer: {
    alignSelf: "stretch",
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    padding: spacing.xs,
    width: "100%",
  },
  codeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  codeLanguage: { color: colors.textDim, ...typeScale.caption, textTransform: "uppercase" },
  codeScroll: { flexGrow: 0, maxWidth: "100%" },
  codeText: { color: colors.text, ...typeScale.code },
  copyHint: { color: colors.textDim, ...typeScale.caption },
  copyHintDone: { color: colors.green },
  deleted: { color: colors.textMuted, textDecorationLine: "line-through" },
  document: { gap: spacing.xs, minWidth: 0 },
  emphasis: { fontStyle: "italic" },
  footnote: {
    alignItems: "flex-start",
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    paddingTop: spacing.xs,
    width: "100%",
  },
  footnoteBody: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  footnoteMarker: { color: colors.accent, ...typeScale.caption },
  heading: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    marginTop: spacing.xxs,
  },
  headingMinor: { ...typeScale.body },
  headingOne: { ...typeScale.title },
  headingThree: { ...typeScale.body },
  headingTwo: { ...typeScale.title },
  image: { backgroundColor: colors.code, borderRadius: radii.medium, height: 220, width: "100%" },
  inlineCode: { backgroundColor: colors.code, color: colors.text, ...typeScale.code },
  link: { color: colors.accent, textDecorationLine: "underline" },
  list: { alignSelf: "flex-start", gap: spacing.xxs, minWidth: 0 },
  listBody: { flexShrink: 1, gap: spacing.optical, minWidth: 0 },
  listMarker: {
    color: colors.textMuted,
    ...typeScale.body,

    textAlign: "right",
    width: 19,
  },
  listRow: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  paragraph: { color: colors.text, ...typeScale.body, minWidth: 0 },
  rawHtml: { color: colors.textMuted, ...typeScale.code },
  rule: { height: 8 },
  secondary: { color: colors.textMuted },
  strong: { fontWeight: typeWeight.semibold },
  table: {
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableCell: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: 1,
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,

    minWidth: TABLE_CELL_WIDTH,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  tableCellHeader: { fontWeight: typeWeight.semibold },
  tableHeader: { backgroundColor: colors.surfaceHover },
  tableRow: { borderBottomColor: colors.borderSoft, borderBottomWidth: 1, flexDirection: "row" },
  tableViewport: {
    alignSelf: "stretch",
    flexGrow: 0,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  taskMarker: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    minHeight: 18,
    paddingTop: spacing.optical,
    width: 19,
  },
  truncated: { borderTopColor: colors.borderSoft, borderTopWidth: 1, paddingTop: spacing.xs },
});
