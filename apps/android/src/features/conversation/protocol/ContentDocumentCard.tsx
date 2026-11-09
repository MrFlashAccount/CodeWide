import type { RenderBlock } from "@codewide/renderers";
import { useContext, type ReactNode } from "react";
import type { GetTransferAccess } from "../../../data/private-transfer";
import { useEvent } from "../../../react/useEvent";
import type { ContentPresentation } from "../../../services/content/contentRouteSession";
import { blockContentDocument } from "../content/blockContentDocument";
import { LargeContentViewerContext } from "../content/contentViewerContext";
import { Card } from "../turns/Card";
import { protocolCopyText } from "./protocolCopyText";
import { protocolIcon } from "./protocolKind";

/**
 * A step whose content the Companion keeps partly out of line, and which has
 * no viewer of its own that reads it: a press opens the whole item, inline
 * text and referenced fields, in the content viewer.
 */
export function ContentDocumentCard({
  block,
  children = null,
  getTransferAccess,
  inline,
  title,
}: {
  readonly block: RenderBlock;
  /** The detail a sheet shows when the step is presented in place. */
  readonly children?: ReactNode;
  readonly getTransferAccess: GetTransferAccess | null;
  readonly inline: { readonly presentation: ContentPresentation; readonly text: string };
  readonly title: string;
}): ReactNode {
  const openContent = useContext(LargeContentViewerContext);
  const document = blockContentDocument({ block, getTransferAccess, inline, title });
  const open = useEvent(() => {
    if (openContent !== null && document !== null) {
      openContent(document);
    }
  });
  return (
    <Card
      copyText={() => protocolCopyText(block)}
      icon={protocolIcon(block.kind)}
      onOpen={open}
      openEnabled={openContent !== null && document !== null}
      openLabel={`Open ${title} output`}
      title={title}
      {...(block.status === null ? {} : { status: block.status })}
    >
      {children}
    </Card>
  );
}
