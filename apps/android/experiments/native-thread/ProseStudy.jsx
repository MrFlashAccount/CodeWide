import React from "react";
import { LegendList } from "@legendapp/list/react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeModules, requireNativeComponent, View, useWindowDimensions } from "react-native";
import { colors, spacing, typeScale, iconSize } from "../../src/theme";
import { useEvent } from "../../src/react/useEvent";
import { useConstant } from "../../src/react/useConstant";
import { productFonts } from "../../src/ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../src/ui/typography-policy";
import { RichMarkdownDocumentBlockView } from "../../src/rendering/RichMarkdown";
import { richMarkdownGeometry as geometry } from "../../src/rendering/richMarkdownGeometry";
import { isSafeLink } from "@codewide/rendering-core";

const Host = requireNativeComponent("CodeWideLabProse");
const nativeLayout = NativeModules.CodeWideLabProseLayout;
const glyphs = Ionicons.glyphMap;

function supportedInline(node) {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "break":
      return true;
    case "link":
      if (!isSafeLink(node.url)) return false;
      return node.children.every(supportedInline);
    case "strong":
    case "emphasis":
    case "delete":
      return node.children.every(supportedInline);
    default:
      return false;
  }
}

function inline(out, nodes, style) {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "break":
        out.push({ ...style, text: node.type === "break" ? "\n" : node.value });
        break;
      case "strong":
      case "emphasis":
      case "delete": {
        const childStyle =
          node.type === "strong"
            ? { ...style, font: productFonts.semibold }
            : node.type === "emphasis"
              ? { ...style, font: productFonts.regular, italic: true }
              : { ...style, font: productFonts.regular, strike: true, color: colors.textMuted };
        inline(out, node.children, childStyle);
        break;
      }
      case "inlineCode":
        out.push({ ...style, font: "monospace", code: true, text: node.value });
        break;
      case "link": {
        const linkStyle = {
          ...style,
          underline: true,
          color: colors.accent,
          font: productFonts.regular,
        };
        inline(out, node.children, linkStyle);
        out.push(
          { ...linkStyle, text: " " },
          {
            ...linkStyle,
            text: String.fromCodePoint(glyphs["open-outline"]),
            icon: true,
            font: "ionicons",
          },
        );
        break;
      }
      default:
        throw new Error("Unsupported node in selected prose fixture");
    }
  }
}

function project(block, scale) {
  const { node } = block;
  const heading = node.type === "heading";
  const font = heading ? productFonts.semibold : productFonts.regular;
  const typography =
    heading && node.depth === 1
      ? typeScale.heading
      : heading && node.depth === 2
        ? typeScale.title
        : typeScale.body;
  const runs = [];
  const style = {
    font,
    color: colors.text,
    italic: false,
    code: false,
    icon: false,
    underline: false,
    strike: false,
  };
  inline(runs, node.children, style);
  return {
    font,
    size: typography.fontSize * scale,
    lineHeight: typography.lineHeight * scale,
    margin: heading ? geometry.headingMarginTop : 0,
    runs,
  };
}

// Keep the production parser and production virtualized row boundaries in both arms. Only select
// original, completed text blocks. A rich sample must contain actual formatting in its paragraph.
function range(rows, kind) {
  const groups = [];
  for (const row of rows) {
    if (row.kind !== "turnSlice") continue;
    if (!row.parts.length || row.parts.some((p) => p.kind !== "markdownBlock" || p.streaming))
      continue;
    let blocks = [];
    const publish = () => {
      if (blocks.length === 0) return;
      const rich = blocks.some(
        (b) =>
          b.node.type === "paragraph" &&
          b.node.children.some((n) =>
            ["strong", "emphasis", "delete", "inlineCode", "link"].includes(n.type),
          ),
      );
      if (
        kind === "rich"
          ? rich
          : blocks.every(
              (b) => b.node.type === "paragraph" && b.node.children.every((n) => n.type === "text"),
            )
      ) {
        groups.push({ key: row.key + "/" + blocks[0].key, blocks });
      }
      blocks = [];
    };
    for (const part of row.parts) {
      const node = part.block.node;
      if (
        (node.type === "paragraph" || node.type === "heading") &&
        node.children.length > 0 &&
        node.children.every(supportedInline)
      ) {
        blocks.push(part.block);
      } else {
        publish();
      }
    }
    publish();
  }
  return groups;
}

function PreparedGroup({ width, scale, blocks }) {
  const prepared = useConstant(() =>
    nativeLayout.prepare({
      width,
      gap: geometry.blockGap,
      iconSize: iconSize.indicator * scale,
      codeColor: colors.code,
      blocks: blocks.map((block) => project(block, scale)),
    }),
  );
  if (prepared === null) throw new Error("Prose experiment preparation limit reached");
  return (
    <Host
      testID="lab-prose-native-group"
      prepared={prepared.id}
      style={{ width, height: prepared.height }}
    />
  );
}

export function ProseStudy({ arm, kind, rows, props }) {
  const [width, setWidth] = React.useState(0);
  const scale = Math.min(useWindowDimensions().fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const data = range(rows, kind);
  const layout = useEvent((e) => setWidth(e.nativeEvent.layout.width));
  const ready = useEvent(() => {
    if (data.length > 0) props.commitInitialTimelineLoad();
  });
  const render = ({ item }) => (
    <View style={{ width, paddingBottom: geometry.blockGap }}>
      {arm === "native" ? (
        <PreparedGroup
          key={item.key + "/" + width + "/" + scale}
          blocks={item.blocks}
          width={width}
          scale={scale}
        />
      ) : (
        <View style={{ gap: geometry.blockGap }}>
          {item.blocks.map((block) => (
            <RichMarkdownDocumentBlockView completedChat key={block.key} block={block} />
          ))}
        </View>
      )}
    </View>
  );
  return (
    <View
      style={{
        flex: 1,
        marginHorizontal: spacing.md,
        marginTop: 64,
        marginBottom: 120,
        backgroundColor: colors.messageSurface,
      }}
      testID="conversation-timeline"
    >
      <View
        style={{ flex: 1 }}
        onLayout={layout}
        testID={`lab-prose-${arm}-${kind}-${data.length}`}
      >
        {width > 0 && data.length > 0 && (
          <LegendList
            data={data}
            renderItem={render}
            keyExtractor={(item) => item.key}
            onLoad={ready}
            recycleItems={false}
            estimatedItemSize={180}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}
