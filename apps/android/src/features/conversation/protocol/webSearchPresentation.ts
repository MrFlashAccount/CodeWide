import type { RenderBlock } from "@codewide/renderers";
import { isSafeHttpUrl } from "../../../rendering/http-link";

const WEB_PREFIX_LENGTH = "www.".length;

export type WebSearchResult = {
  readonly domain: string | null;
  readonly key: string;
  readonly snippet: string | null;
  readonly title: string;
  readonly url: string | null;
};

/** Validates the provider-owned raw search payload before presentation consumes it. */
export function webSearchResults(block: RenderBlock): readonly WebSearchResult[] {
  return rawWebSearchResults(block).map((result, index) => {
    const urlValue = nonEmptyString(result.url);
    const url = urlValue !== null && isSafeHttpUrl(urlValue) ? urlValue : null;
    const domain = webSearchDomain(url);
    const title = nonEmptyString(result.title) ?? domain ?? `Result ${String(index + 1)}`;
    const snippet = nonEmptyString(result.snippet) ?? nonEmptyString(result.text);
    return {
      domain,
      key: url ?? `${title}\u0000${snippet ?? ""}`,
      snippet,
      title,
      url,
    };
  });
}

/** The sheet header and Activity row share one interpretation of the query payload. */
export function webSearchSummary(block: RenderBlock): {
  readonly query: string;
  readonly resultCount: number;
} {
  return {
    query: nonEmptyString(block.raw.query) ?? "Search",
    resultCount: rawWebSearchResults(block).length,
  };
}

function rawWebSearchResults(block: RenderBlock): readonly Record<string, unknown>[] {
  if (!Array.isArray(block.raw.results)) {
    return [];
  }
  return block.raw.results.filter(
    (result): result is Record<string, unknown> =>
      result !== null && typeof result === "object" && !Array.isArray(result),
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function webSearchDomain(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    const hostname = new URL(url).hostname.toLocaleLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(WEB_PREFIX_LENGTH) : hostname;
  } catch {
    return null;
  }
}
