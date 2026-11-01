import { View } from "react-native";

import { AppSwitch } from "../../../ui/AppSwitch";
import type { DockCounts } from "./dockCounts";
import { submitSheetStyles as styles } from "./SubmitReviewSheet.styles";
import { SheetLineText } from "./VerdictRow";

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** What Submit does with the drafts: PR comments, forwarded Both halves, agent-only drafts that stay. */
export function SubmitSummaryLines({
  bothTargetTitle,
  busy,
  counts,
  forward,
  host,
  onForwardChange,
}: {
  readonly bothTargetTitle: string | null;
  readonly busy: boolean;
  readonly counts: DockCounts;
  readonly forward: boolean;
  readonly host: string;
  readonly onForwardChange: (forward: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.line}>
        <SheetLineText
          detail={`Published to ${host} with the verdict`}
          title={`${plural(counts.toPr, "comment", "comments")} to PR`}
        />
      </View>
      {counts.bothPending === 0 ? null : (
        <View style={styles.line}>
          <SheetLineText
            detail={`To ${bothTargetTitle ?? "the linked thread"}`}
            title={`Also send ${plural(counts.bothPending, "“Both” comment", "“Both” comments")} to agent`}
          />
          <AppSwitch
            accessibilityLabel="Also send Both comments to agent"
            disabled={busy}
            onValueChange={onForwardChange}
            value={forward}
          />
        </View>
      )}
      {counts.agentOnly === 0 ? null : (
        <View style={styles.line}>
          <SheetLineText
            detail="Send it from the draft or the Changes list"
            title={`${plural(counts.agentOnly, "agent-only draft stays", "agent-only drafts stay")} here`}
          />
        </View>
      )}
    </>
  );
}
