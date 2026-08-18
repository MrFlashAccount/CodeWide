import { describe, expect, it } from "vitest";

import {
  collapsedCodePreview,
  nativeCodeHeight,
  nativeCodePreview,
  normalizeNativeCodeLanguage,
  nativeCodeLanguageForPath,
  stripTerminalControlSequences,
  NATIVE_CODE_DEFAULT_MAX_HEIGHT,
  NATIVE_CODE_MAX_PREVIEW_LINES,
} from "../src/rendering/native-code-block";

describe("native code block projection", () => {
  it("normalizes Markdown language aliases without changing unknown grammars", () => {
    expect(normalizeNativeCodeLanguage("TS")).toBe("typescript");
    expect(normalizeNativeCodeLanguage("language-bash")).toBe("shellscript");
    expect(normalizeNativeCodeLanguage("custom-lang")).toBe("custom-lang");
    expect(normalizeNativeCodeLanguage("typescript", "diff")).toBe("typescript");
    expect(normalizeNativeCodeLanguage("diff", "diff")).toBe("diff");
    expect(nativeCodeLanguageForPath("apps/android/src/App.tsx")).toBe("tsx");
    expect(nativeCodeLanguageForPath("native/Engine.kt")).toBe("kotlin");
    expect(nativeCodeLanguageForPath("native/engine.cpp")).toBe("cpp");
    expect(nativeCodeLanguageForPath("cmd/main.go")).toBe("go");
    expect(nativeCodeLanguageForPath("no-extension")).toBe("text");
  });

  it("uses a deterministic bounded height for native layout", () => {
    expect(nativeCodeHeight("one line")).toBe(24);
    expect(nativeCodeHeight("a\nb\nc", 400, 2)).toBe(40);
    expect(nativeCodeHeight(Array.from({ length: 100 }, (_, index) => String(index)).join("\n"))).toBe(NATIVE_CODE_DEFAULT_MAX_HEIGHT);
  });

  it("keeps collapsed code at the requested edge", () => {
    const source = "one\ntwo\nthree\nfour";
    expect(collapsedCodePreview(source, 3, false)).toBe("one\ntwo\n…");
    expect(collapsedCodePreview(source, 3, true)).toBe("…\nthree\nfour");
  });

  it("bounds pathological inline output before it reaches Android TextView", () => {
    const preview = nativeCodePreview(Array.from({ length: NATIVE_CODE_MAX_PREVIEW_LINES + 10 }, () => "line").join("\n"));
    expect(preview.truncated).toBe(true);
    expect(preview.value.split("\n")).toHaveLength(NATIVE_CODE_MAX_PREVIEW_LINES);
  });

  it("removes terminal control sequences from the plain fallback without losing text", () => {
    expect(stripTerminalControlSequences("\u001b[31mfailed\u001b[0m\r\nnext\rstep\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007"))
      .toBe("failed\nnext\nsteplink");
  });
});
