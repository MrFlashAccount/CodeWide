import {
  HTMLElementModel,
  HTMLContentModel,
  isDomElement,
  type RenderHTMLProps,
} from "@native-html/render";

import { colors, spacing, typeScale, typeWeight } from "../theme";
import { productFonts } from "../ui/product-fonts";

const block = (tagName: string) =>
  HTMLElementModel.fromCustomModel({ tagName, contentModel: HTMLContentModel.block });
const textual = (tagName: string) =>
  HTMLElementModel.fromCustomModel({ tagName, contentModel: HTMLContentModel.textual });

/** Message HTML cannot execute scripts, load a document, or override application geometry. */
export const nativeMarkupConfig = {
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
  baseStyle: { color: colors.text, fontFamily: productFonts.regular, ...typeScale.body },
  customHTMLElementModels: {
    form: block("form"),
    fieldset: block("fieldset"),
    dialog: block("dialog"),
    button: textual("button"),
    label: textual("label"),
    legend: textual("legend"),
    output: textual("output"),
    select: textual("select"),
    option: textual("option"),
    textarea: textual("textarea"),
    audio: block("audio"),
    video: block("video"),
    progress: block("progress"),
    meter: block("meter"),
    input: HTMLElementModel.fromCustomModel({
      tagName: "input",
      contentModel: HTMLContentModel.textual,
      isVoid: true,
    }),
    details: block("details"),
    summary: block("summary"),
    table: block("table"),
    thead: block("thead"),
    tbody: block("tbody"),
    tfoot: block("tfoot"),
    tr: block("tr"),
    td: block("td"),
    th: block("th"),
    "cw-display-math": block("cw-display-math"),
    "cw-inline-math": textual("cw-inline-math"),
  },
  tagsStyles: {
    p: { marginTop: 0, marginBottom: spacing.xs },
    h1: typeScale.heading,
    h2: typeScale.heading,
    h3: typeScale.title,
    h4: typeScale.title,
    h5: typeScale.title,
    h6: typeScale.title,
    b: { fontFamily: productFonts.semibold, fontWeight: typeWeight.regular },
    strong: { fontFamily: productFonts.semibold, fontWeight: typeWeight.regular },
    code: { ...typeScale.code, backgroundColor: colors.code },
    pre: { ...typeScale.code, marginTop: 0, marginBottom: spacing.xs },
    kbd: typeScale.code,
    samp: typeScale.code,
    small: typeScale.label,
    figcaption: { ...typeScale.label, color: colors.textMuted },
    ul: { paddingLeft: spacing.lg, marginTop: 0, marginBottom: spacing.xs },
    ol: { paddingLeft: spacing.lg, marginTop: 0, marginBottom: spacing.xs },
    blockquote: {
      borderLeftWidth: 2,
      borderLeftColor: colors.outline,
      paddingLeft: spacing.sm,
      marginHorizontal: 0,
    },
    mark: { backgroundColor: colors.warningContainer },
    th: { fontFamily: productFonts.semibold },
  },
} satisfies Omit<RenderHTMLProps, "source">;
