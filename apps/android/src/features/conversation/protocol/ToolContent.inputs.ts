import { type RenderBlock } from "@codewide/renderers";

export type ToolCallProtocolBlockInput = {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};

export type ToolCallProtocolDetailsInput = {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};

export type ToolCallResultContentInput = {
  block: RenderBlock;
  section: string;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};

export type ToolRichContentInput = {
  items: unknown[];
  section: string;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};

export type ToolResourceLinkInput = { uri: string; label: string };

export type LazyJsonProtocolBodyInput = {
  value: unknown;
  section?: string;
};

export type ProtocolBodyInput = {
  body: string;
  code: boolean;
  collapsible: boolean;
  expandedMaxHeight?: number;
  section?: string;
  language?: string;
  codeVariant?: "code" | "diff" | "terminal";
  showCopyAction?: boolean;
};
