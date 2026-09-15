import RenderHTML, { isDomElement, TChildrenRenderer, TNodeChildrenRenderer, type CustomRendererProps, type TBlock, type TNode, type TPhrasing, type TText } from "@native-html/render";
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { NativeMarkupTable } from "./NativeMarkupTable";
import { MarkupInput, MarkupProgress } from "./NativeMarkupControls";
import { nativeMarkupConfig } from "./native-markup-config";
import { RichContentWidthProvider, useRichContentWidth } from "./RichContentLayout";
import { markupNodePath } from "./markup-node-path";
import { markupImageDimensions, type MarkupImageDimensions } from "./markup-image-dimensions";
import { highlightMessageMarkup } from "@codewide/rendering-core/markup";
import { SearchHighlightQuery } from "./SearchMessageFocus";

interface MarkupCapabilities {
  readonly code: (source: string, language: string, path: string) => ReactNode;
  readonly image: (source: string, title: string, dimensions?: MarkupImageDimensions) => ReactNode;
  readonly link: (href: string, content: ReactNode) => ReactNode;
}
interface NativeMarkupProps extends MarkupCapabilities { readonly html: string }
type MixedProps = CustomRendererProps<TBlock | TPhrasing | TText>;
const Capabilities = createContext<MarkupCapabilities | null>(null);
const MathSurface = lazy(() => import("./NativeMath"));

/** The library owns HTML layout; adapters retain the app's file, link and code capabilities. */
export function NativeMarkup(props: NativeMarkupProps): ReactNode {
  const query = useContext(SearchHighlightQuery);
  const available = useRichContentWidth();
  const window = useWindowDimensions();
  return <Capabilities.Provider value={props}><RenderHTML
    {...nativeMarkupConfig} contentWidth={available ?? window.width} source={{ html: highlightMessageMarkup(props.html, query) }}
    renderers={renderers} defaultTextProps={{ selectable: true, maxFontSizeMultiplier: 1.3 }}
  /></Capabilities.Provider>;
}

function useCapabilities(): MarkupCapabilities {
  const capabilities = useContext(Capabilities);
  if (capabilities === null) throw new Error("Native markup requires presentation capabilities");
  return capabilities;
}

function nodeText(node: TNode): string {
  return node.type === "text" ? node.data : node.children.map(nodeText).join("");
}

function findTag(node: TNode, tag: string): TNode | undefined {
  if (node.tagName === tag) return node;
  for (const child of node.children) {
    const found = findTag(child, tag);
    if (found !== undefined) return found;
  }
  return undefined;
}

function PreRenderer(props: CustomRendererProps<TBlock>): ReactNode {
  const capabilities = useCapabilities();
  const code = findTag(props.tnode, "code");
  const language = /(?:^|\s)language-([^\s]+)/u.exec(code?.attributes.class ?? "")?.[1] ?? "text";
  return capabilities.code(nodeText(props.tnode).replace(/\n$/u, ""), language, markupNodePath(props.tnode));
}

function ImageRenderer(props: MixedProps): ReactNode {
  return useCapabilities().image(props.tnode.attributes.src ?? "", props.tnode.attributes.alt ?? "Image", markupImageDimensions(props.tnode.attributes));
}

function LinkRenderer(props: MixedProps): ReactNode {
  return useCapabilities().link(props.tnode.attributes.href ?? "", <TNodeChildrenRenderer tnode={props.tnode} />);
}

function MediaRenderer(props: MixedProps): ReactNode {
  const capabilities = useCapabilities();
  const dom = props.tnode.domNode;
  const source = dom !== null && isDomElement(dom) ? dom.children.find((node) => isDomElement(node) && node.name === "source") : undefined;
  const href = props.tnode.attributes.src ?? (source !== undefined && isDomElement(source) ? source.attribs.src : "") ?? "";
  const title = props.tnode.attributes.title ?? props.tnode.tagName ?? "Media";
  return <Text style={styles.text}>{capabilities.link(href, title)}</Text>;
}

function MathRenderer(props: MixedProps): ReactNode {
  const source = nodeText(props.tnode);
  return <Suspense fallback={<Text selectable style={styles.code}>{source}</Text>}>
    <MathSurface source={source} display={props.tnode.tagName === "cw-display-math"} />
  </Suspense>;
}

function DetailsRenderer(props: CustomRendererProps<TBlock>): ReactNode {
  const available = useRichContentWidth();
  const query = useContext(SearchHighlightQuery);
  // A search match inside collapsed HTML must be visible when the chat opens.
  const [expanded, setExpanded] = useState(Object.hasOwn(props.tnode.attributes, "open") || (query !== "" && findTag(props.tnode, "mark") !== undefined));
  const summary = props.tnode.children.find((node) => node.tagName === "summary");
  const body = props.tnode.children.filter((node) => node !== summary);
  return <View style={styles.details}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.summary}>
      <Svg width={iconSize.inline} height={iconSize.inline} viewBox="0 0 24 24" accessible={false}>
        <Path d={expanded ? "M5 9L12 16L19 9" : "M9 5L16 12L9 19"} fill="none" stroke={colors.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={styles.summaryText}>{summary !== undefined ? <TNodeChildrenRenderer tnode={summary} /> : <Text style={styles.text}>Details</Text>}</View>
    </Pressable>
    {expanded && <View style={styles.detailsBody}><RichContentWidthProvider width={available === null ? null : Math.max(1, available - spacing.sm * 2)}><TChildrenRenderer tchildren={body} /></RichContentWidthProvider></View>}
  </View>;
}

const renderers = { pre: PreRenderer, img: ImageRenderer, a: LinkRenderer, details: DetailsRenderer,
  input: MarkupInput, progress: MarkupProgress, meter: MarkupProgress, video: MediaRenderer, audio: MediaRenderer,
  table: NativeMarkupTable, "cw-inline-math": MathRenderer, "cw-display-math": MathRenderer };

const styles = StyleSheet.create({
  code: { color: colors.text, ...typeScale.code },
  text: { color: colors.text, fontFamily: productFonts.regular, ...typeScale.body },
  details: { minWidth: 0, borderRadius: radii.small, backgroundColor: colors.surfaceContainerLow },
  summary: { minHeight: controlSize.regular, padding: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  summaryText: { flex: 1, minWidth: 0 },
  detailsBody: { padding: spacing.sm, paddingTop: 0 },
});
