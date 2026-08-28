import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  documentPreviewSurface,
  isolatedHtmlDocument,
  markdownLineTarget,
  previewableDocumentKind,
  remoteFileKind,
  remoteDocumentDirectory,
  resolvePreviewableDocumentLink,
  resolveRemoteDocumentPath,
} from "../src/rendering/document-preview";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");
const nativeEditor = readFileSync(new URL("../src/rendering/CodeReviewEditor.native.tsx", import.meta.url), "utf8");
const editorRuntime = readFileSync(new URL("../code-review-editor/entry.ts", import.meta.url), "utf8");
const documentPreview = readFileSync(new URL("../src/rendering/DocumentPreviewHost.tsx", import.meta.url), "utf8");

describe("document preview", () => {
  it("routes previewable documents, images and downloads by file type", () => {
    expect(previewableDocumentKind("README.md", "/repo/README.md")).toBe("markdown");
    expect(previewableDocumentKind("README.md", "/repo/attachment-1")).toBe("markdown");
    expect(previewableDocumentKind("guide.markdown", "/repo/guide.markdown")).toBe("markdown");
    expect(previewableDocumentKind("report.HTML", "/repo/report.HTML")).toBe("html");
    expect(previewableDocumentKind("page.xhtml", "/repo/page.xhtml")).toBe("html");
    expect(previewableDocumentKind("script.ts", "/repo/script.ts")).toBeNull();
    expect(remoteFileKind("script.ts", "/repo/script.ts")).toBe("text");
    expect(remoteFileKind("Screen.tsx:2080", "/repo/Screen.tsx:2080")).toBe("text");
    expect(remoteFileKind("README.md:42", "/repo/README.md:42")).toBe("markdown");
    expect(remoteFileKind("component.svelte", "/repo/component.svelte")).toBe("text");
    expect(remoteFileKind("Dockerfile", "/repo/Dockerfile")).toBe("text");
    expect(remoteFileKind("CMakeLists.txt", "/repo/CMakeLists.txt")).toBe("text");
    expect(remoteFileKind(".gitignore", "/repo/.gitignore")).toBe("text");
    expect(remoteFileKind("screen.PNG", "/repo/screen.PNG")).toBe("image");
    expect(remoteFileKind("archive.zip", "/repo/archive.zip")).toBe("download");
  });

  it("uses a distinct presentation surface for each file strategy", () => {
    expect(documentPreviewSurface("image")).toBe("image-viewer");
    expect(documentPreviewSurface("html")).toBe("fullscreen");
    expect(documentPreviewSurface("markdown")).toBe("fullscreen");
    expect(documentPreviewSurface("text")).toBe("sheet");
    expect(documentPreviewSurface("download")).toBe("download");
  });

  it("resolves attached relative document links against the remote thread cwd", () => {
    expect(resolveRemoteDocumentPath("docs/../README.md", "/srv/project/apps/mobile")).toBe("/srv/project/apps/mobile/README.md");
    expect(resolveRemoteDocumentPath("../docs/My%20Guide.md#intro", "/srv/project/apps/mobile")).toBe("/srv/project/apps/docs/My Guide.md");
    expect(resolveRemoteDocumentPath("/srv/project/README.md", "/ignored")).toBe("/srv/project/README.md");
    expect(resolveRemoteDocumentPath("/srv/project/src/Screen.tsx:2080", "/ignored")).toBe("/srv/project/src/Screen.tsx");
    expect(resolveRemoteDocumentPath("src/Screen.tsx:2080:14", "/srv/project")).toBe("/srv/project/src/Screen.tsx");
    expect(resolveRemoteDocumentPath("artifacts/build.zip:2080", "/srv/project")).toBe("/srv/project/artifacts/build.zip:2080");
    expect(resolveRemoteDocumentPath("https://example.test/README.md", "/srv/project")).toBeNull();
    expect(resolveRemoteDocumentPath("#section", "/srv/project")).toBeNull();
  });

  it("classifies previewable links and keeps nested documents relative to their parent", () => {
    expect(resolvePreviewableDocumentLink("../docs/README.md", "/srv/project/apps")).toEqual({
      kind: "markdown",
      name: "README.md",
      path: "/srv/project/docs/README.md",
    });
    expect(resolvePreviewableDocumentLink("preview/index.HTML?mode=compact", "/srv/project")).toEqual({
      kind: "html",
      name: "index.HTML",
      path: "/srv/project/preview/index.HTML",
    });
    expect(resolvePreviewableDocumentLink("source.ts", "/srv/project")).toEqual({
      kind: "text",
      name: "source.ts",
      path: "/srv/project/source.ts",
    });
    expect(resolvePreviewableDocumentLink("src/Screen.tsx:2080", "/srv/project")).toEqual({
      kind: "text",
      name: "Screen.tsx",
      path: "/srv/project/src/Screen.tsx",
      line: 2080,
    });
    expect(resolvePreviewableDocumentLink("src/Screen.tsx:2080:14", "/srv/project")).toEqual({
      kind: "text",
      name: "Screen.tsx",
      path: "/srv/project/src/Screen.tsx",
      line: 2080,
      column: 14,
    });
    expect(resolvePreviewableDocumentLink("README.md:42", "/srv/project")).toEqual({
      kind: "markdown",
      name: "README.md",
      path: "/srv/project/README.md",
      line: 42,
    });
    expect(resolvePreviewableDocumentLink("artifacts/build.zip", "/srv/project")).toEqual({
      kind: "download",
      name: "build.zip",
      path: "/srv/project/artifacts/build.zip",
    });
    expect(remoteDocumentDirectory("/srv/project/docs/README.md")).toBe("/srv/project/docs");
  });

  it("opens source references at a one-shot highlighted line without opening a comment", () => {
    expect(screen).toContain('initialLine: request.line');
    expect(screen).toContain('initialColumn: request.column');
    expect(screen).not.toContain('target.kind === "text" || target.line !== undefined');
    expect(screen).toContain('if (target.kind === "text") openCodeDocument(request);');
    expect(screen).toContain('if (request.kind === "text") {');
    expect(screen).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(workspace).toContain('revealReference={selectedReference === null ? revealReference : null}');
    expect(nativeEditor).toContain('send({ command: "reveal", payload: revealReference })');
    expect(editorRuntime).toContain('revealedReference = parsed.payload');
    expect(editorRuntime).toContain('scrollIntoView({ block: "center", inline: "nearest" })');
  });

  it("keeps Markdown source lines in the fullscreen renderer and maps them to a rendered segment", () => {
    const source = "# Intro\n\nFirst\n\n## Details\n\nBody";
    const segments = ["# Intro\n\nFirst\n\n", "## Details\n\nBody"];

    expect(markdownLineTarget(source, segments, 1)).toEqual({ segmentIndex: 0, line: 1 });
    expect(markdownLineTarget(source, segments, 5)).toEqual({ segmentIndex: 1, line: 1 });
    expect(markdownLineTarget(source, segments, 7)).toEqual({ segmentIndex: 1, line: 3 });
    expect(markdownLineTarget(source, segments, undefined)).toBeNull();
  });

  it("owns Markdown reading controls in the fullscreen viewer chrome", () => {
    expect(documentPreview).toContain('accessibilityLabel="Back from document preview"');
    expect(documentPreview).toContain('name="arrow-back"');
    expect(documentPreview).toContain('name="ellipsis-vertical"');
    expect(documentPreview).toContain('{ id: "download", label: "Download"');
    expect(documentPreview).toContain('id: "text-smaller"');
    expect(documentPreview).toContain('id: "text-reset"');
    expect(documentPreview).toContain('id: "text-larger"');
    expect(documentPreview).not.toContain("<DocumentTextScaleControl");
    expect(documentPreview).toContain('id === "text-smaller"');
    expect(documentPreview).toContain('id === "text-reset"');
    expect(documentPreview).toContain('id === "text-larger"');
    expect(documentPreview).toContain('{ id: "layout-reading", label: "Reading width"');
    expect(documentPreview).toContain('{ id: "layout-wide", label: "Full width"');
    expect(documentPreview).toContain("<RichMarkdownTextScaleProvider scale={textScale}>");
    expect(documentPreview).toContain("layoutMode === \"reading\" && styles.documentReading");
    expect(documentPreview).toContain("documentReadingWidth(textScale)");
    expect(documentPreview).toContain("useDocumentViewerPreferences()");
  });

  it("injects an isolation policy into complete and fragment HTML", () => {
    const complete = isolatedHtmlDocument("<!doctype html><html><head><title>x</title></head><body>ok</body></html>");
    expect(complete).toContain("Content-Security-Policy");
    expect(complete).toContain("script-src 'none'");
    expect(complete).toContain("connect-src 'none'");
    expect(complete.indexOf("Content-Security-Policy")).toBeLessThan(complete.indexOf("<title>"));

    const fragment = isolatedHtmlDocument("<h1>Preview</h1>");
    expect(fragment).toContain("<!doctype html>");
    expect(fragment).toContain("<body><h1>Preview</h1></body>");
  });
});
