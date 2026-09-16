import { createContext } from "react";
import type { DocumentPreviewRequest } from "./DocumentPreviewHost";

/** Timeline and composer attachments delegate preview navigation to the owning generation. */
export const ThreadCodeDocumentContext = createContext<
  ((request: DocumentPreviewRequest) => void) | null
>(null);
