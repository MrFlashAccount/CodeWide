import type { RenderBlock } from "@codewide/renderers";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { formatDuration } from "../../../ui/number-format";
import { AppText as Text } from "../../../ui/Typography";
import { LargeContentControls } from "../content/FullContentViewer";
import { Card } from "../turns/Card";
import { styles } from "./ProtocolBlock.styles";
import { protocolCopyText } from "./protocolCopyText";
import { isToolActivityKind, protocolIcon } from "./protocolKind";
import { ProtocolBody } from "./ToolContent";

/** Default protocol card presentation after the declared kinds have dispatched. */
export function renderProtocolFallback(
  block: RenderBlock,
  displayTitle: string,
  getTransferAccess: (() => Promise<{ authorization: string; baseUrl: string }>) | undefined,
) {
  return (
    <Card
      icon={protocolIcon(block.kind)}
      title={displayTitle}
      {...(block.status === null ? {} : { status: block.status })}
      collapsible={block.collapsible}
      copyText={() => protocolCopyText(block)}
      initiallyExpanded={
        !isToolActivityKind(block.kind) &&
        (block.status === "inProgress" || block.status === "running")
      }
    >
      {block.body !== null &&
        (block.kind === "reasoning" ||
        block.kind === "plan" ||
        block.kind === "turnPlan" ||
        block.kind === "hookPrompt" ? (
          <RichMarkdown source={block.body} />
        ) : (
          <ProtocolBody
            body={block.body}
            code={block.kind === "fileChange" || block.kind === "turnDiff"}
            collapsible={block.collapsible}
            {...(block.kind === "turnDiff" || block.kind === "fileChange"
              ? { codeVariant: "diff" as const, language: "diff" }
              : {})}
          />
        ))}
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
      <LargeContentControls
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}
