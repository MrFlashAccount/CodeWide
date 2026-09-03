export type NativeCodeVariant = "code" | "diff" | "terminal";

const NATIVE_CODE_LINE_HEIGHT = 20;
const NATIVE_CODE_VERTICAL_PADDING = 4;
const NATIVE_CODE_DEFAULT_MAX_HEIGHT = 400;
const NATIVE_CODE_MAX_PREVIEW_LINES = 2000;
const NATIVE_CODE_MAX_PREVIEW_CHARS = 200_000;

const LANGUAGE_ALIASES = new Map<string, string>([
  ["bash", "bash"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["html", "html"],
  ["javascript", "javascript"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "jsx"],
  ["md", "markdown"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["typescript", "typescript"],
  ["yml", "yaml"],
]);

export interface NativeCodePreview {
  originalLines: number;
  truncated: boolean;
  value: string;
}

export interface FullCodePage {
  id: string;
  value: string;
}

export function normalizeNativeCodeLanguage(
  language: string,
  variant: NativeCodeVariant = "code",
): string {
  const normalized = language
    .trim()
    .toLocaleLowerCase()
    .replace(/^language-/u, "");
  if (variant === "diff" && (normalized === "" || normalized === "text")) return "diff";
  if (normalized === "") return "text";
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

export function nativeCodePreview(value: string): NativeCodePreview {
  const originalLines = value === "" ? 1 : value.split("\n").length;
  if (
    value.length <= NATIVE_CODE_MAX_PREVIEW_CHARS &&
    originalLines <= NATIVE_CODE_MAX_PREVIEW_LINES
  ) {
    return { originalLines, truncated: false, value };
  }
  const bounded = value
    .slice(0, NATIVE_CODE_MAX_PREVIEW_CHARS)
    .split("\n")
    .slice(0, NATIVE_CODE_MAX_PREVIEW_LINES)
    .join("\n");
  return { originalLines, truncated: true, value: bounded };
}

/** @testOnly Keeps the string-only compatibility assertion for paged code rendering. */
export function fullCodePages(value: string, pageLines = 500): string[] {
  return fullCodePageEntries(value, pageLines).map((page) => page.value);
}

export function fullCodePageEntries(value: string, pageLines = 500): FullCodePage[] {
  const lines = value.split("\n");
  const pageSize = Math.max(1, pageLines);
  const result: FullCodePage[] = [];
  for (let start = 0; start < lines.length; start += pageSize) {
    result.push({
      id: `lines:${start + 1}-${Math.min(lines.length, start + pageSize)}`,
      value: lines.slice(start, start + pageSize).join("\n"),
    });
  }
  return result;
}

export function nativeCodeHeight(
  value: string,
  maxHeight = NATIVE_CODE_DEFAULT_MAX_HEIGHT,
  maxVisibleLines?: number,
): number {
  const lines = value === "" ? 1 : value.split("\n").length;
  const visibleLines =
    maxVisibleLines === undefined ? lines : Math.min(lines, Math.max(1, maxVisibleLines));
  return Math.min(
    maxHeight,
    visibleLines * NATIVE_CODE_LINE_HEIGHT + NATIVE_CODE_VERTICAL_PADDING * 2,
  );
}

export function stripTerminalControlSequences(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const code = value.codePointAt(index) ?? 0;
    if (code === 27) {
      index = skipEscapeSequence(value, index + 1);
      continue;
    }
    if (code === 13) {
      if (value.codePointAt(index + 1) !== 10) result += "\n";
      index += 1;
      continue;
    }
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) {
      index += 1;
      continue;
    }
    result += String.fromCodePoint(code);
    index += code > 65_535 ? 2 : 1;
  }
  return result;
}

function skipEscapeSequence(value: string, start: number): number {
  const mode = value.codePointAt(start);
  let index = start + 1;
  if (mode === 93) {
    while (index < value.length) {
      const code = value.codePointAt(index);
      if (code === 7) return index + 1;
      if (code === 27 && value.codePointAt(index + 1) === 92) return index + 2;
      index += 1;
    }
    return index;
  }
  while (index < value.length) {
    const code = value.codePointAt(index) ?? 0;
    index += 1;
    if (code >= 64 && code <= 126) return index;
  }
  return index;
}
