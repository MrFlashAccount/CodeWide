import { readFileSync } from "node:fs";

export const ownerImageProtocolBlock = readFileSync(
  new URL("../../src/features/conversation/protocol/ImageProtocolBlock.tsx", import.meta.url),
  "utf8",
);
export const ownerFileChangeProtocolBlock = readFileSync(
  new URL("../../src/features/conversation/protocol/FileChangeProtocolBlock.tsx", import.meta.url),
  "utf8",
);
export const ownerToolContent = readFileSync(
  new URL("../../src/features/conversation/protocol/ToolContent.tsx", import.meta.url),
  "utf8",
);
export const ownerProtocolBlock = readFileSync(
  new URL("../../src/features/conversation/protocol/ProtocolBlock.tsx", import.meta.url),
  "utf8",
);
export const ownerProtocolBlockStyles = readFileSync(
  new URL("../../src/features/conversation/protocol/ProtocolBlock.styles.ts", import.meta.url),
  "utf8",
);
export const ownerToolImages = readFileSync(
  new URL("../../src/features/conversation/protocol/toolImages.tsx", import.meta.url),
  "utf8",
);
export const toolContentStyles = readFileSync(
  new URL("../../src/features/conversation/protocol/ToolContent.styles.ts", import.meta.url),
  "utf8",
);
