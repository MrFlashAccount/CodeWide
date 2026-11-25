import { describe, expect, it } from "vitest";

import { isExplicitAsciiDiagram, repairSvgbobUnicodeText, themedAsciiDiagramSvg } from "../src/rendering/ascii-diagram";
import { renderSvgbob } from "@codewide/rendering-core/ascii";

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

describe("ASCII diagram selection", () => {
  it("renders only explicitly tagged ASCII diagram fences", () => {
    expect(isExplicitAsciiDiagram("ascii")).toBe(true);
    expect(isExplicitAsciiDiagram("bob")).toBe(true);
    expect(isExplicitAsciiDiagram("diagram")).toBe(true);
    expect(isExplicitAsciiDiagram("svgbob")).toBe(true);
    expect(isExplicitAsciiDiagram("language-svgbob")).toBe(true);

    expect(isExplicitAsciiDiagram(null)).toBe(false);
    expect(isExplicitAsciiDiagram("text")).toBe(false);
    expect(isExplicitAsciiDiagram("plaintext")).toBe(false);
    expect(isExplicitAsciiDiagram("typescript")).toBe(false);
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

  it("reassembles Svgbob's overlapping Cyrillic text fragments on their original cell grid", async () => {
    const source = `Пользователь касается строки треда
              │
              ▼
       onPressIn: preload
              │
              ▼
     Прочитать сохранённый anchor`;
    const broken = await renderSvgbob(source);
    expect(broken).toContain(">Плзвтл</text>");
    expect(broken).toContain(">оьоаеь</text>");

    const repaired = repairSvgbobUnicodeText(broken);
    expect(repaired).toContain(">Пользователь</text>");
    expect(repaired).toContain(">касается</text>");
    expect(repaired).toContain(">Прочитать сохранённый</text>");
    expect(repaired).not.toContain(">Плзвтл</text>");
    expect(repaired).toMatch(/<text x="2 10 18 26 34 42 50 58 66 74 82 90" y="12">Пользователь<\/text>/u);
  });

  it("escapes markup-like labels before the SVG reaches the web image surface", async () => {
    const svg = await renderSvgbob("<script>alert(1)</script>\nA --> B");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
