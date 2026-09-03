import { describe, expect, it } from "vitest";

import { parseRichMarkdown } from "@codewide/rendering-core";

import { looksLikeAsciiDiagram } from "../src/v2/rendering/diagramModel";
import { safeMarkdownImageUri } from "../src/v2/rendering/imageSource";
import { classifyMarkdownLink } from "../src/v2/rendering/linkClassification";
import {
  fullCodePages,
  nativeCodePreview,
  normalizeNativeCodeLanguage,
  stripTerminalControlSequences,
} from "../src/v2/rendering/nativeCodeBlockModel";
import { extensionCardModel } from "../src/v2/rendering/richExtensionModel";
import { collectMarkdownImages, githubAlert } from "../src/v2/rendering/richMarkdownModel";
import { ResolvedImageResource } from "../src/v2/rendering/resolvedImageResource";

describe("V2 rich rendering", () => {
  it("keeps loopback and remote file links behind injected capabilities", () => {
    expect(classifyMarkdownLink("http://localhost:3000/docs")).toEqual({
      kind: "loopback",
      url: "http://localhost:3000/docs",
    });
    expect(classifyMarkdownLink("src/app.tsx:42")).toEqual({
      href: "src/app.tsx:42",
      kind: "remoteFile",
    });
    expect(classifyMarkdownLink("javascript:alert(1)")).toEqual({ kind: "rejected" });
    expect(classifyMarkdownLink("http://localhost/docs")).toEqual({ kind: "rejected" });
    expect(classifyMarkdownLink("https://example.test/docs")).toEqual({
      kind: "external",
      url: "https://example.test/docs",
    });
  });

  it("accepts only bounded HTTPS or inline image sources without a private resolver", () => {
    expect(safeMarkdownImageUri("https://example.test/image.png")).toBe(
      "https://example.test/image.png",
    );
    expect(safeMarkdownImageUri("http://example.test/image.png")).toBeNull();
    expect(safeMarkdownImageUri("file:///data/private.png")).toBeNull();
    expect(safeMarkdownImageUri("https://localhost/private.png")).toBeNull();
    expect(safeMarkdownImageUri("iVBORw0KGgoAAAA")).toBe("data:image/png;base64,iVBORw0KGgoAAAA");
  });

  it("prefers an authenticated resolver over a public-looking attachment URL", async () => {
    const reference = {
      alt: "private",
      id: "image-private",
      reference: "https://companion.test/v2/files/private.png",
    };
    const resource = new ResolvedImageResource([reference], async () => ({
      headers: { "X-Preview": "secure" },
      uri: "https://stream.test/private.png",
    }));

    expect(resource.snapshot()).toStrictEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(resource.snapshot()).toStrictEqual([
      {
        ...reference,
        order: 0,
        source: {
          headers: { "X-Preview": "secure" },
          uri: "https://stream.test/private.png",
        },
      },
    ]);
  });

  it("resolves Markdown images when the native runtime has no Array.toSorted", () => {
    const toSortedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    try {
      const first = {
        alt: "first",
        id: "image-first",
        reference: "https://example.test/first.png",
      };
      const second = {
        alt: "second",
        id: "image-second",
        reference: "https://example.test/second.png",
      };

      const resource = new ResolvedImageResource([first, second], undefined);

      expect(resource.snapshot().map((item) => item.id)).toEqual([first.id, second.id]);
    } finally {
      if (toSortedDescriptor !== undefined) {
        Object.defineProperty(Array.prototype, "toSorted", toSortedDescriptor);
      }
    }
  });

  it("collects gallery images in document order", () => {
    const root = parseRichMarkdown(
      "[![one](https://a.test/1.png)](https://a.test/full)\n\n![two](private://two)",
    ).root;
    expect(collectMarkdownImages(root).map((item) => item.reference)).toEqual([
      "https://a.test/1.png",
      "private://two",
    ]);
    expect(collectMarkdownImages(root)[0]?.link).toBe("https://a.test/full");
  });

  it("recognizes GitHub alert blocks without mutating ordinary quotes", () => {
    const alertNode = parseRichMarkdown("> [!WARNING]\n> Careful").root.children[0];
    const quoteNode = parseRichMarkdown("> Ordinary quote").root.children[0];
    expect(alertNode?.type).toBe("blockquote");
    expect(quoteNode?.type).toBe("blockquote");
    if (alertNode?.type !== "blockquote" || quoteNode?.type !== "blockquote") {
      throw new Error("Markdown parser did not preserve quote blocks");
    }
    expect(githubAlert(alertNode)?.label).toBe("Warning");
    expect(githubAlert(quoteNode)).toBeNull();
  });

  it("bounds native code previews while preserving the original line count", () => {
    const preview = nativeCodePreview(`${"x\n".repeat(2100)}tail`);
    expect(preview.truncated).toBe(true);
    expect(preview.originalLines).toBe(2101);
    expect(preview.value.split("\n")).toHaveLength(2000);
    expect(normalizeNativeCodeLanguage("TS")).toBe("typescript");
    expect(fullCodePages("a\nb\nc", 2)).toEqual(["a\nb", "c"]);
  });

  it("strips terminal controls in fallback output", () => {
    expect(stripTerminalControlSequences("\u001B[31mred\u001B[0m\rnext")).toBe("red\nnext");
  });

  it("detects diagrams conservatively", () => {
    expect(looksLikeAsciiDiagram("┌───┐\n│ A │ → B\n└───┘\n  ↓", "text")).toBe(true);
    expect(looksLikeAsciiDiagram("const x = a - b;\nreturn x;\nfoo();\nbar();", "ts")).toBe(false);
  });

  it("projects supported codex fences into specialized cards", () => {
    expect(extensionCardModel("web-search", null, '{"query":"React Activity"}')).toEqual({
      detail: "React Activity",
      label: "Web search",
    });
    expect(extensionCardModel("unknown", null, "payload")).toBeNull();
  });
});
