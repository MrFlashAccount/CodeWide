import type { RenderBlock } from "@codewide/renderers";
import type { TransferAccess } from "../../../data/private-transfer";

export interface ToolContentProps {
  block: RenderBlock;
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
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
