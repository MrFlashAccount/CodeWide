/** V1 contentViewerContext owner, extracted without changing interaction or resource lifetime. */
import type { RenderContentReference } from "@codewide/renderers";
import { createContext } from "react";

export type LargeContentViewerRequest = {
  pointer: string;
  reference: RenderContentReference;
  presentation: "markdown" | "terminal" | "text";
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};

export const LargeContentViewerContext = createContext<
  ((request: LargeContentViewerRequest) => void) | null
>(null);
