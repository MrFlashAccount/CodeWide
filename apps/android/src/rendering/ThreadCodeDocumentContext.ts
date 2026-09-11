import { createContext } from "react";
import type { DocumentPreviewRequest } from "./DocumentPreviewHost";

/** Text attachments and message links use the same thread-owned code viewer. */
export const ThreadCodeDocumentContext = createContext<((request: DocumentPreviewRequest) => void) | null>(null);
