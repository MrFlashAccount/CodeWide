import nativeCodeLanguageManifest from "./native-code-languages.json";

export type NativeCodeVariant = "code" | "diff" | "terminal";

export const NATIVE_CODE_LINE_HEIGHT = 16;
export const NATIVE_CODE_VERTICAL_PADDING = 4;
export const NATIVE_CODE_DEFAULT_MAX_HEIGHT = 400;
export const NATIVE_CODE_MAX_PREVIEW_LINES = 2_000;
export const NATIVE_CODE_MAX_PREVIEW_CHARS = 200_000;

type NativeCodeLanguageDefinition = {
  id: string;
  aliases: string[];
  extensions: string[];
};

const nativeCodeLanguages = nativeCodeLanguageManifest as NativeCodeLanguageDefinition[];
const LANGUAGE_ALIASES = new Map<string, string>();
const EXTENSION_LANGUAGES = new Map<string, string>();
for (const language of nativeCodeLanguages) {
  LANGUAGE_ALIASES.set(language.id, language.id);
  for (const alias of language.aliases) LANGUAGE_ALIASES.set(alias, language.id);
  for (const extension of language.extensions) EXTENSION_LANGUAGES.set(extension, language.id);
}

export function normalizeNativeCodeLanguage(language: string, variant: NativeCodeVariant = "code"): string {
  const normalized = language.trim().toLocaleLowerCase().replace(/^language-/, "");
  const resolved = LANGUAGE_ALIASES.get(normalized) ?? (normalized || "text");
  if (variant === "diff" && (resolved === "text" || resolved === "diff")) return "diff";
  return resolved;
}

/** Web/plain fallback only. Android parses ANSI into native Spannable runs. */
export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, "")
    .replace(/\u001B[P^_X][\s\S]*?\u001B\\/gu, "")
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\u001B[@-_]/gu, "")
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/gu, "");
}

export function nativeCodeLanguageForPath(path: string): string {
  const normalized = path.split(/[?#]/u, 1)[0]?.toLocaleLowerCase() ?? "";
  const extension = normalized.match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
  return EXTENSION_LANGUAGES.get(extension) ?? "text";
}

export function nativeCodePreview(value: string): { value: string; truncated: boolean; originalLines: number } {
  const originalLines = value === "" ? 1 : value.split("\n").length;
  if (value.length <= NATIVE_CODE_MAX_PREVIEW_CHARS && originalLines <= NATIVE_CODE_MAX_PREVIEW_LINES) {
    return { value, truncated: false, originalLines };
  }
  const lines = value.slice(0, NATIVE_CODE_MAX_PREVIEW_CHARS).split("\n").slice(0, NATIVE_CODE_MAX_PREVIEW_LINES);
  return { value: lines.join("\n"), truncated: true, originalLines };
}

export function nativeCodeHeight(value: string, maxHeight = NATIVE_CODE_DEFAULT_MAX_HEIGHT, maxVisibleLines?: number): number {
  const lineCount = value === "" ? 1 : value.split("\n").length;
  const visibleLines = maxVisibleLines === undefined ? lineCount : Math.min(lineCount, Math.max(1, maxVisibleLines));
  return Math.min(maxHeight, visibleLines * NATIVE_CODE_LINE_HEIGHT + NATIVE_CODE_VERTICAL_PADDING * 2);
}

export function collapsedCodePreview(value: string, lines: number, fromEnd: boolean): string {
  const sourceLines = value.split("\n");
  if (sourceLines.length <= lines) return value;
  const visible = fromEnd ? sourceLines.slice(-lines + 1) : sourceLines.slice(0, lines - 1);
  return fromEnd ? ["…", ...visible].join("\n") : [...visible, "…"].join("\n");
}
