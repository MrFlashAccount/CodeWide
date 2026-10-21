import type { RenderBlock } from "@codewide/renderers";
import { useContext, type ReactElement } from "react";
import { turnChangedFiles } from "../../../rendering/turn-changes";
import { TurnChangesContext } from "../../../rendering/TurnChangesContext";
import { useEvent } from "../../../react/useEvent";
import { Card } from "../turns/Card";
import { TurnTargetContext } from "../turns/turnContexts";
import { protocolCopyText } from "./protocolCopyText";
import { ProtocolBody } from "./ToolContent";

/**
 * A turn's recorded diff. It opens the turn's changes in the Changes
 * workspace, the same view as the turn's footer; where that workspace is not
 * offered the activity sheet discloses the diff in place.
 */
export function TurnDiffProtocolBlock({ block }: { readonly block: RenderBlock }): ReactElement {
  const presentChanges = useContext(TurnChangesContext);
  const turnTarget = useContext(TurnTargetContext);
  const diff = block.body ?? "";
  const canOpen = presentChanges !== null && turnTarget !== null && diff.trim() !== "";
  const openChanges = useEvent(() => {
    if (presentChanges !== null && turnTarget !== null) {
      presentChanges(turnTarget, turnChangedFiles(diff), "turn");
    }
  });
  return (
    <Card
      collapsible
      copyText={() => protocolCopyText(block)}
      icon="git-compare-outline"
      initiallyExpanded={false}
      title={block.title}
      {...(canOpen ? { onOpen: openChanges, openLabel: "Open the changes of this turn" } : {})}
    >
      <ProtocolBody
        body={diff}
        code
        codeVariant="diff"
        collapsible={block.collapsible}
        language="diff"
      />
    </Card>
  );
}
