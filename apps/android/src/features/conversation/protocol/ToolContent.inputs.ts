import type { RenderBlock } from "@codewide/renderers";

export type ToolCallProtocolBlockInput = {
  block: RenderBlock;
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
};

export type ToolCallProtocolDetailsInput = {
  block: RenderBlock;
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
};

export type ToolCallResultContentInput = {
  block: RenderBlock;
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
  section: string;
};

export type ToolRichContentInput = {
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
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
