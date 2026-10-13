import type { RenderBlock } from "@codewide/renderers";
import type { TransferAccess } from "../../../data/private-transfer";

export type ToolCallProtocolBlockInput = {
  block: RenderBlock;
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
};

export type ToolCallProtocolDetailsInput = {
  block: RenderBlock;
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
};

export type ToolCallResultContentInput = {
  block: RenderBlock;
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
  section: string;
};

export type ToolRichContentInput = {
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
  items: unknown[];
  section: string;
};

export type ToolResourceLinkInput = { label: string; uri: string };

export type LazyJsonProtocolBodyInput = {
  section?: string;
  value: unknown;
};

export type ProtocolBodyInput = {
  body: string;
  code: boolean;
  codeVariant?: "code" | "diff" | "terminal";
  collapsible: boolean;
  expandedMaxHeight?: number;
  language?: string;
  section?: string;
  showCopyAction?: boolean;
};
