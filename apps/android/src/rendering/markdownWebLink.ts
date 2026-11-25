import { createContext } from "react";
import type { MarkdownLocalLinkHandler } from "./MarkdownLinkHandler";

/** A surface that can open web links without providing a local filesystem. */
export const MarkdownWebLinkContext = createContext<MarkdownLocalLinkHandler | null>(null);
