import type { RenderBlock } from "@codewide/renderers";
import { useContext } from "react";
import { subagentActivityTargetThreadId } from "../../../data/subagent-projection";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppListItem } from "../../../ui/AppListItem";
import { listRowHeight } from "../../../ui/AppListRow.types";
import { LargeContentViewerContext } from "../content/contentViewerContext";
import { SubagentNavigationContext, TurnActivityMetricsContext } from "../turns/turnContexts";
import { protocolActivityRow } from "./protocolActivityRow";
import { protocolCopyText } from "./protocolCopyText";

type ActivityRowAction =
  | { readonly kind: "inactive" }
  | {
      readonly accessibilityLabel: string;
      readonly kind: "open";
      readonly onPress: () => void;
    };

/** A non-card Activity row either owns a semantic destination or remains informational. */
export function ActivityProtocolListRow({
  block,
}: {
  readonly block: RenderBlock;
}): React.JSX.Element {
  const metrics = useContext(TurnActivityMetricsContext);
  const openContent = useContext(LargeContentViewerContext);
  const openSubagent = useContext(SubagentNavigationContext);
  const row = protocolActivityRow(block, metrics);
  const title = activityRowTitle(block);
  const content = unknownOutput(block);
  const targetThreadId = subagentTargetThreadId(block);
  const openUnknown = useEvent(() => {
    if (openContent !== null && content !== "") {
      const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
      openContent({
        kind: "inline",
        presentation: "text",
        text: content,
        title: `Unsupported · ${rawType}`,
      });
    }
  });
  const openAgent = useEvent(() => {
    if (openSubagent !== null && targetThreadId !== null) {
      openSubagent(targetThreadId);
    }
  });
  const action = activityRowAction({
    block,
    canOpenContent: openContent !== null && content !== "",
    canOpenSubagent: openSubagent !== null && targetThreadId !== null,
    openAgent,
    openUnknown,
    title,
  });
  return action.kind === "open" ? (
    <OpenActivityRow action={action} row={row} title={title} />
  ) : (
    <InactiveActivityRow row={row} title={title} />
  );
}

type ActivityRowPresentationProps = {
  readonly row: ReturnType<typeof protocolActivityRow>;
  readonly title: string;
};

function OpenActivityRow({
  action,
  row,
  title,
}: ActivityRowPresentationProps & {
  readonly action: Extract<ActivityRowAction, { kind: "open" }>;
}): React.JSX.Element {
  return (
    <AppListItem
      accessibilityLabel={action.accessibilityLabel}
      danger={row.failed}
      description={row.description}
      fixedHeight={listRowHeight.double}
      leadingIcon={{ name: row.icon }}
      onPress={action.onPress}
      testID="activity-step-row"
      title={title}
      trailingIcon={
        row.failed ? { color: colors.red, name: "alert-circle" } : { name: "chevron-forward" }
      }
    />
  );
}

function InactiveActivityRow({ row, title }: ActivityRowPresentationProps): React.JSX.Element {
  return (
    <AppListItem
      accessibilityLabel={title}
      danger={row.failed}
      description={row.description}
      fixedHeight={listRowHeight.double}
      leadingIcon={{ name: row.icon }}
      testID="activity-step-row"
      title={title}
      {...(row.failed
        ? { trailingIcon: { color: colors.red, name: "alert-circle" as const } }
        : {})}
    />
  );
}

function activityRowTitle(block: RenderBlock): string {
  return block.title === "" ? "Activity step" : block.title;
}

function unknownOutput(block: RenderBlock): string {
  return block.kind === "unknown" ? protocolCopyText(block) : "";
}

function subagentTargetThreadId(block: RenderBlock): string | null {
  return block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity"
    ? subagentActivityTargetThreadId(block.raw)
    : null;
}

function activityRowAction({
  block,
  canOpenContent,
  canOpenSubagent,
  openAgent,
  openUnknown,
  title,
}: {
  readonly block: RenderBlock;
  readonly canOpenContent: boolean;
  readonly canOpenSubagent: boolean;
  readonly openAgent: () => void;
  readonly openUnknown: () => void;
  readonly title: string;
}): ActivityRowAction {
  if (block.kind === "unknown" && canOpenContent) {
    return { accessibilityLabel: `Open ${title} output`, kind: "open", onPress: openUnknown };
  }
  if (
    (block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity") &&
    canOpenSubagent
  ) {
    return { accessibilityLabel: `Open subagent ${title}`, kind: "open", onPress: openAgent };
  }
  return { kind: "inactive" };
}
