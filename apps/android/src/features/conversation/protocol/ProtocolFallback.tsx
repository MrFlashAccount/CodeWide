import type { RenderBlock } from "@codewide/renderers";
import type { ReactElement } from "react";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { formatDuration } from "../../../ui/number-format";
import { AppText as Text } from "../../../ui/Typography";
import { hasContentReferences } from "../content/blockContentDocument";
import { Card } from "../turns/Card";
import { ContentDocumentCard } from "./ContentDocumentCard";
import { styles } from "./ProtocolBlock.styles";
import { protocolCopyText } from "./protocolCopyText";
import { protocolIcon } from "./protocolKind";
import { ProtocolBody } from "./ToolContent";
import type { TransferAccess } from "../../../data/private-transfer";

/**
 * Default protocol card presentation after the declared kinds have dispatched.
 * A step with out-of-line fields opens its whole content in the viewer.
 */
export function renderProtocolFallback(
  block: RenderBlock,
  displayTitle: string,
  getTransferAccess: (() => Promise<TransferAccess>) | undefined,
): ReactElement {
  const details = renderFallbackDetails(block);
  if (hasContentReferences(block)) {
    return (
      <ContentDocumentCard
        block={block}
        getTransferAccess={getTransferAccess ?? null}
        inline={{
          presentation: rendersMarkdown(block) ? "markdown" : "text",
          text: block.body ?? protocolCopyText(block),
        }}
        title={displayTitle}
      >
        {details}
      </ContentDocumentCard>
    );
  }
  return (
    <Card
      icon={protocolIcon(block.kind)}
      title={displayTitle}
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
    >
      {details}
    </Card>
  );
}

/** The body and duration a sheet shows when the step is presented in place. */
function renderFallbackDetails(block: RenderBlock): ReactElement {
  return (
    <>
      {block.body !== null &&
        (rendersMarkdown(block) ? (
          <RichMarkdown source={block.body} />
        ) : (
          <ProtocolBody
            body={block.body}
            code={block.kind === "fileChange"}
            collapsible={block.collapsible}
            {...(block.kind === "fileChange"
              ? { codeVariant: "diff" as const, language: "diff" }
              : {})}
          />
        ))}
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
    </>
  );
}

function rendersMarkdown(block: RenderBlock): boolean {
  return (
    block.kind === "reasoning" ||
    block.kind === "plan" ||
    block.kind === "turnPlan" ||
    block.kind === "hookPrompt"
  );
}
