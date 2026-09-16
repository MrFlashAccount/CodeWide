import {
  HTMLElementModel,
  HTMLContentModel,
  isDomElement,
  type RenderHTMLProps,
} from "@native-html/render";

import { colors, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";

const block = (tagName: string) =>
  HTMLElementModel.fromCustomModel({ contentModel: HTMLContentModel.block, tagName });
const textual = (tagName: string) =>
  HTMLElementModel.fromCustomModel({ contentModel: HTMLContentModel.textual, tagName });

/** Message HTML cannot execute scripts, load a document, or override application geometry. */
export const nativeMarkupConfig = {
  baseStyle: { color: colors.text, fontFamily: productFonts.regular, ...typeScale.body },
  customHTMLElementModels: {
    audio: block("audio"),
    button: textual("button"),
    "cw-display-math": block("cw-display-math"),
    "cw-inline-math": textual("cw-inline-math"),
    details: block("details"),
    dialog: block("dialog"),
    fieldset: block("fieldset"),
    form: block("form"),
    input: HTMLElementModel.fromCustomModel({
      contentModel: HTMLContentModel.textual,
      isVoid: true,
      tagName: "input",
    }),
    label: textual("label"),
    legend: textual("legend"),
    meter: block("meter"),
    option: textual("option"),
    output: textual("output"),
    progress: block("progress"),
    select: textual("select"),
    summary: block("summary"),
    table: block("table"),
    tbody: block("tbody"),
    td: block("td"),
    textarea: textual("textarea"),
    tfoot: block("tfoot"),
    th: block("th"),
    thead: block("thead"),
    tr: block("tr"),
    video: block("video"),
  },
  enableCSSInlineProcessing: false,
  ignoredDomTags: [
    "script",
    "style",
    "head",
    "title",
    "meta",
    "link",
    "base",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
    "canvas",
  ],
  ignoreDomNode: (node) => isDomElement(node) && Object.hasOwn(node.attribs, "hidden"),
  systemFonts: ["sans-serif", "serif", "monospace", ...Object.values(productFonts)],
  tagsStyles: {
    b: { fontFamily: productFonts.semibold, fontWeight: typeWeight.regular },
    blockquote: {
      borderLeftColor: colors.outline,
      borderLeftWidth: 2,
      marginHorizontal: 0,
      paddingLeft: spacing.sm,
    },
    code: { ...typeScale.code, backgroundColor: colors.code },
    figcaption: { ...typeScale.label, color: colors.textMuted },
    h1: typeScale.heading,
    h2: typeScale.heading,
    h3: typeScale.title,
    h4: typeScale.title,
    h5: typeScale.title,
    h6: typeScale.title,
    kbd: typeScale.code,
    mark: { backgroundColor: colors.warningContainer },
    ol: { marginBottom: spacing.xs, marginTop: 0, paddingLeft: spacing.lg },
    p: { marginBottom: spacing.xs, marginTop: 0 },
    pre: { ...typeScale.code, marginBottom: spacing.xs, marginTop: 0 },
    samp: typeScale.code,
    small: typeScale.label,
    strong: { fontFamily: productFonts.semibold, fontWeight: typeWeight.regular },
    th: { fontFamily: productFonts.semibold },
    ul: { marginBottom: spacing.xs, marginTop: 0, paddingLeft: spacing.lg },
  },
} satisfies Omit<RenderHTMLProps, "source">;
