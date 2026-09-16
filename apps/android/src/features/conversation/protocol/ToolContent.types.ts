import type { RenderBlock } from "@codewide/renderers";

export interface ToolContentProps {
  block: RenderBlock;
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
}
export interface ToolResourceLinkProps {
  label: string;
  uri: string;
}
export interface LazyJsonBodyProps {
  section?: string;
  value: unknown;
}
export interface ProtocolBodyProps {
  body: string;
  code: boolean;
  codeVariant?: "code" | "diff" | "terminal";
  collapsible: boolean;
  expandedMaxHeight?: number;
  language?: string;
  section?: string;
  showCopyAction?: boolean;
}
