import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sourceHasJsxElement, sourceObjectDeclaration } from "../source-contract";
import {
  ownerImageProtocolBlock,
  ownerFileChangeProtocolBlock,
  ownerToolContent,
  ownerProtocolBlock,
  ownerProtocolBlockStyles,
  ownerToolImages,
  toolContentStyles,
} from "./conversation-protocol-sources";

const ownerToolArguments = readFileSync(
  new URL("../../src/features/conversation/protocol/ToolArguments.tsx", import.meta.url),
  "utf8",
);
const ownerToolRichItems = readFileSync(
  new URL("../../src/features/conversation/protocol/ToolRichItems.tsx", import.meta.url),
  "utf8",
);

const imageFrame = readFileSync(
  new URL("../../src/features/conversation/protocol/OpenableImageFrame.tsx", import.meta.url),
  "utf8",
);

const protocolView = readFileSync(
  new URL("../../src/features/conversation/protocol/ProtocolBodyView.tsx", import.meta.url),
  "utf8",
);

it("preserves conversation protocol integration contracts", () => {
  expect(ownerImageProtocolBlock).toContain(
    "const privateImage = usePrivateImageUri(source.uri, source.headers, retryRevision)",
  );
  expect(
    sourceHasJsxElement(imageFrame, "Pressable", [
      "openImagePreview({",
      "...previewItem",
      "groupId: resolvedGroupId",
      "source: resolvedSource",
    ]),
  ).toBe(true);
  expect(
    sourceHasJsxElement(ownerFileChangeProtocolBlock, "NativeCodeBlock", [
      "language={nativeCodeLanguageForPath(path)}",
      "value={projection.renderSource}",
      'variant="diff"',
    ]),
  ).toBe(true);
  expect(ownerToolContent).toContain("usePersistentExpansion(`${itemKey}:body:${section}`, false)");
  expect(ownerToolArguments).toContain('section="arguments"');
  expect(ownerToolArguments).toContain('section="progress"');
  expect(ownerToolContent).toContain('section="result"');
  expect(ownerToolContent).toContain("const TOOL_RESULT_MAX_HEIGHT = 400");
  expect(ownerToolContent).toContain("expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}");
  expect(protocolView).toContain("nestedScrollEnabled");
  expect(ownerProtocolBlock).toContain('testID="thinking-status"');
  expect(ownerProtocolBlock).toContain("insideTurnActivity && styles.thinkingStatusInActivity");
  const thinkingStatus = sourceObjectDeclaration(ownerProtocolBlockStyles, "thinkingStatus");
  expect(thinkingStatus).toContain('alignItems: "center"');
  expect(thinkingStatus).toContain('flexDirection: "row"');
  expect(thinkingStatus).toContain("gap: spacing.compact");
  expect(thinkingStatus).toContain("minHeight: controlSize.compact");
  expect(thinkingStatus).toContain("minWidth: 0");
  expect(thinkingStatus).toContain("paddingHorizontal: 0");
  expect(ownerProtocolBlockStyles).toContain("thinkingStatusInActivity: { paddingLeft: 0 }");
  expect(ownerImageProtocolBlock).toContain(
    "usePrivateAssetUri(props.source, attempt, props.getTransferAccess)",
  );
  expect(ownerToolImages).toContain("privateImageAssetProjection(item.codewideAsset)");
  expect(ownerToolImages).toMatch(
    /source=\{\{(?=[^}]*id: projectedAsset\.id)(?=[^}]*kind: "content")[^}]*\}\}/u,
  );
  expect(ownerImageProtocolBlock).toContain(
    "privateImageAssetProjection(props.block.raw.codewideAsset)",
  );
  expect(ownerToolRichItems).toContain('type === "inputText" || type === "input_text"');
  expect(protocolView).toContain("fillAvailableWidth");
  expect(ownerToolRichItems).toContain("toolTextNeedsCodeViewport(item.text)");
  expect(sourceObjectDeclaration(toolContentStyles, "protocolBody")).toContain('width: "100%"');
  expect(ownerImageProtocolBlock).toContain("const resolvedSource = privateImage.source");
  expect(ownerImageProtocolBlock).toContain(
    "usePrivateImageUri(source.uri, source.headers, retryRevision)",
  );
});
