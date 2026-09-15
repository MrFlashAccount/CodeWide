import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ownerImageProtocolBlock,
  ownerFileChangeProtocolBlock,
  ownerToolContent,
  ownerProtocolBlock,
  ownerProtocolBlockStyles,
  ownerToolImages,
  toolContentStyles,
} from "./conversation-protocol-sources";

const ownerToolArguments = readFileSync(new URL("../../src/features/conversation/protocol/ToolArguments.tsx", import.meta.url), "utf8");
const ownerToolRichItems = readFileSync(new URL("../../src/features/conversation/protocol/ToolRichItems.tsx", import.meta.url), "utf8");

const imageFrame = readFileSync(new URL("../../src/features/conversation/protocol/OpenableImageFrame.tsx", import.meta.url), "utf8");

const protocolView = readFileSync(new URL("../../src/features/conversation/protocol/ProtocolBodyView.tsx", import.meta.url), "utf8");

it("preserves conversation protocol integration contracts", () => {
  expect(ownerImageProtocolBlock).toContain(
    "const privateImage = usePrivateImageUri(source.uri, source.headers, retryRevision)",
  );
  expect(imageFrame).toMatch(
    /onPress=\{\(\) =>\s*openImagePreview\(\{ \.\.\.previewItem, source: resolvedSource, groupId: resolvedGroupId \}\)\s*\}/,
  );
  expect(ownerFileChangeProtocolBlock).toMatch(
    /<NativeCodeBlock\s+value=\{projection\.renderSource\}\s+language=\{nativeCodeLanguageForPath\(path\)\}\s+variant="diff"/,
  );
  expect(ownerToolContent).toContain("usePersistentExpansion(`${itemKey}:body:${section}`, false)");
  expect(ownerToolArguments).toContain("section=\"arguments\"");
  expect(ownerToolArguments).toContain("section=\"progress\"");
  expect(ownerToolContent).toContain('section="result"');
  expect(ownerToolContent).toContain("const TOOL_RESULT_MAX_HEIGHT = 400");
  expect(ownerToolContent).toContain("expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}");
  expect(protocolView).toContain("nestedScrollEnabled");
  expect(ownerProtocolBlock).toContain('testID="thinking-status"');
  expect(ownerProtocolBlock).toContain("insideTurnActivity && styles.thinkingStatusInActivity");
  expect(ownerProtocolBlockStyles).toMatch(
    /thinkingStatus: \{\s*minWidth: 0,\s*minHeight: controlSize\.compact,\s*flexDirection: "row",\s*alignItems: "center",\s*gap: spacing\.compact,\s*paddingHorizontal: 0,?\s*\}/,
  );
  expect(ownerProtocolBlockStyles).toContain("thinkingStatusInActivity: { paddingLeft: 0 }");
  expect(ownerImageProtocolBlock).toContain(
    "usePrivateAssetUri(props.source, attempt, props.getTransferAccess)",
  );
  expect(ownerToolImages).toContain("privateImageAssetProjection(item.codewideAsset)");
  expect(ownerToolImages).toContain('source={{ kind: "content", id: projectedAsset.id }}');
  expect(ownerImageProtocolBlock).toContain("privateImageAssetProjection(props.block.raw.codewideAsset)");
  expect(ownerToolRichItems).toContain("type === \"inputText\" || type === \"input_text\"");
  expect(protocolView).toContain("fillAvailableWidth");
  expect(ownerToolRichItems).toContain("toolTextNeedsCodeViewport(item.text)");
  expect(toolContentStyles).toMatch(/protocolBody: \{\s*width: "100%"/);
  expect(ownerImageProtocolBlock).toContain("const resolvedSource = privateImage.source");
  expect(ownerImageProtocolBlock).toContain(
    "usePrivateImageUri(source.uri, source.headers, retryRevision)",
  );
});
