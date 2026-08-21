import { describe, expect, it } from "vitest";

import { looksLikeAsciiDiagram, themedAsciiDiagramSvg } from "../src/rendering/ascii-diagram";
import { renderSvgbob } from "../src/rendering/svgbob-wasm-runtime.web";

const generatedArchitecture = `                 TypeScript source
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
   Oxc, Rust                    tsgo sidecar, Go
 AST + scopes + CFG        Program + TypeChecker
          │               symbols/types/signatures
          └─────────────┬─────────────┘
                        ▼
                наш Typed HIR
             CFG + places + aliases
                        ▼
            effect inference engine
                        ▼
        contracts / diagnostics / fixes`;

describe("ASCII diagram detection", () => {
  it("recognizes generated box-drawing diagrams without a language tag", () => {
    expect(looksLikeAsciiDiagram(generatedArchitecture, null)).toBe(true);
  });

  it("recognizes conservative plain-ASCII diagrams", () => {
    expect(looksLikeAsciiDiagram("+-----+\n| API |---> worker\n+-----+\n   |\n   v", "text")).toBe(true);
  });

  it("does not steal ordinary source code or prose", () => {
    expect(looksLikeAsciiDiagram("type Step = {\n  from: string;\n  to: string;\n};", "typescript")).toBe(false);
    expect(looksLikeAsciiDiagram("first\n---\nsecond\n---\nthird", "text")).toBe(false);
    expect(looksLikeAsciiDiagram("a -> b\nc -> d\ne -> f\ng -> h", "typescript")).toBe(false);
  });

  it("adds a dark transparent theme to Svgbob output", () => {
    expect(themedAsciiDiagramSvg("<svg class=\"svgbob\"><style>.base{}</style></svg>"))
      .toContain("rect.backdrop { fill: transparent");
    expect(themedAsciiDiagramSvg("<svg><style>.base{}</style></svg>"))
      .toContain('<svg class="svgbob"');
  });

  it("renders the generated architecture through the bundled web WASM runtime", async () => {
    const svg = await renderSvgbob(generatedArchitecture);
    expect(svg).toContain("<svg");
    expect(svg).toContain("TypeScript");
    expect(svg.match(/<line\b/gu)?.length ?? 0).toBeGreaterThan(5);
    expect(svg.match(/<polygon\b/gu)?.length ?? 0).toBeGreaterThan(2);
  });

  it("escapes markup-like labels before the SVG reaches the web image surface", async () => {
    const svg = await renderSvgbob("<script>alert(1)</script>\nA --> B");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
