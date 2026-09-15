import type { RenderBlock } from "@codewide/renderers";
export interface ToolContentProps {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}
export interface ToolResourceLinkProps {
  uri: string;
  label: string;
}
export interface LazyJsonBodyProps {
  value: unknown;
  section?: string;
}
export interface ProtocolBodyProps {
  body: string;
  code: boolean;
  collapsible: boolean;
  expandedMaxHeight?: number;
  section?: string;
  language?: string;
  codeVariant?: "code" | "diff" | "terminal";
  showCopyAction?: boolean;
}
