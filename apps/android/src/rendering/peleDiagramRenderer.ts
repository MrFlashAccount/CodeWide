import { PeleError, render } from "pele";

const MAX_PELE_OUTPUT_CHARS = 4_000_000;
const MAX_PELE_EDGES = 5000;

const PELE_COLOR_REPLACEMENTS: readonly (readonly [string, string])[] = [
  ["var(--pele-bg,#fff)", "#202020"],
  ["var(--pele-fg,#1f1f1f)", "#F2F2F2"],
  ["var(--pele-muted,#6e6e6e)", "#B8B8B8"],
  ["var(--pele-line,#1f1f1f)", "#B8B8B8"],
  ["var(--pele-surface,#f3f3f3)", "#272727"],
  ["var(--pele-surface-alt,#e6e6e6)", "#202020"],
  ["var(--pele-border,#8a8a8a)", "#858585"],
  ["var(--pele-accent,#5b7bd5)", "#E6E6E6"],
  ["var(--pele-radius,4px)", "8px"],
  ["var(--pele-font-mono,monospace)", "monospace"],
  ["var(--pele-font,sans-serif)", "sans-serif"],
  ["var(--_bg)", "#202020"],
  ["var(--_fg)", "#F2F2F2"],
  ["var(--_m)", "#B8B8B8"],
  ["var(--_l)", "#B8B8B8"],
  ["var(--_s)", "#272727"],
  ["var(--_a)", "#202020"],
  ["var(--_b)", "#858585"],
  ["var(--_c)", "#E6E6E6"],
  ["var(--_r)", "8px"],
  ["var(--_fm)", "monospace"],
  ["var(--_hw)", "bold"],
  ["var(--_tw)", "bold"],
  ["var(--_w)", "bold"],
];

const FORBIDDEN_SVG_FRAGMENTS = [
  "<foreignObject",
  "<image",
  "<script",
  "<style",
  " onerror=",
  " onload=",
] as const;

export type PeleDiagramRenderResult =
  | {
      readonly height: number;
      readonly status: "ready";
      readonly svg: string;
      readonly width: number;
    }
  | {
      readonly message: string;
      readonly status: "error";
    };

/** Pure renderer contract shared by the worker runtime and Node fixture tests. */
export function renderPeleDiagramSvg(source: string, sourceLimit: number): PeleDiagramRenderResult {
  "worklet";
  if (source.length > sourceLimit) {
    return { message: "Diagram is too large to render safely", status: "error" };
  }
  try {
    const rendered = render(source, {
      fontFamily: "sans-serif",
      fontFamilyMono: "monospace",
      images: false,
      limit: sourceLimit,
      links: false,
      maxEdges: MAX_PELE_EDGES,
      outputLimit: MAX_PELE_OUTPUT_CHARS,
      responsive: false,
    });
    const svg = makeReactNativeSvg(rendered.svg);
    if (
      !Number.isFinite(rendered.width) ||
      !Number.isFinite(rendered.height) ||
      rendered.width <= 0 ||
      rendered.height <= 0
    ) {
      return { message: "Diagram renderer returned invalid geometry", status: "error" };
    }
    return { height: rendered.height, status: "ready", svg, width: rendered.width };
  } catch (error) {
    return { message: peleErrorMessage(error), status: "error" };
  }
}

function makeReactNativeSvg(source: string): string {
  "worklet";
  let svg = source.replaceAll(/var\(--[^,)]+,([^)]+)\)/g, "$1");
  for (const [variable, value] of PELE_COLOR_REPLACEMENTS) {
    svg = svg.split(variable).join(value);
  }
  const rootEnd = svg.indexOf(">");
  if (rootEnd < 0 || !svg.startsWith("<svg")) {
    throw new Error("Pele returned malformed SVG");
  }
  const root = svg.slice(0, rootEnd);
  const portableRoot = root
    .replace(/\sstyle="[^"]*"/, "")
    .concat(' font-family="sans-serif" font-size="16"');
  svg = portableRoot.concat(svg.slice(rootEnd));
  if (svg.includes("var(")) {
    throw new Error("Pele SVG contains unresolved CSS variables");
  }
  const lower = svg.toLowerCase();
  if (/javascript:/i.test(svg)) {
    throw new Error("Pele SVG contains an executable URL");
  }
  for (const fragment of FORBIDDEN_SVG_FRAGMENTS) {
    if (lower.includes(fragment.toLowerCase())) {
      throw new Error("Pele SVG contains unsupported active content");
    }
  }
  return svg;
}

function peleErrorMessage(cause: unknown): string {
  "worklet";
  if (cause instanceof PeleError) {
    const location = cause.line > 0 ? ` at line ${String(cause.line)}` : "";
    if (cause.code === "unsupported-diagram") {
      return "This Mermaid diagram type is not supported by Pele";
    }
    if (cause.code === "limit") {
      return "Diagram exceeds the renderer safety limit";
    }
    return `Could not parse Mermaid diagram${location}`;
  }
  return "Could not render Mermaid diagram";
}
