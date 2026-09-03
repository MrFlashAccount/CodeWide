import { useState, useTransition, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { QueueDragHandleView } from "./QueueDragHandleView";
import { QueueRowActionView } from "./QueueRowActionView";
import type { QueueRowActions, QueueRowModel } from "./queueTypes";

interface QueueItemRowViewProps {
  actionable: boolean;
  actions: QueueRowActions;
  canMoveDown: boolean;
  canMoveUp: boolean;
  canSteer: boolean;
  editor: ReactNode;
  item: QueueRowModel;
  onEditRequest(itemId: string): void;
  queuedPosition: number;
  queuedTotal: number;
}

export function QueueItemRowView(props: QueueItemRowViewProps): React.JSX.Element {
  const {
    actionable,
    actions,
    canMoveDown,
    canMoveUp,
    canSteer,
    editor,
    item,
    onEditRequest,
    queuedPosition,
    queuedTotal,
  } = props;
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const run = useEvent((action: () => Promise<void>) => {
    if (pending) return;
    setActionError(null);
    startAction(async () => {
      try {
        await action();
      } catch (cause: unknown) {
        setActionError(cause instanceof Error ? cause.message : "Queue action failed");
      }
    });
  });
  const edit = useEvent(() => {
    if (actionable) onEditRequest(item.id);
  });
  const cancel = useEvent(() => run(() => actions.onCancel(item.id)));
  const retry = useEvent(() => run(() => actions.onRetry(item.id)));
  const move = useEvent((offset: number) => run(() => actions.onMove(item.id, offset)));
  const steer = useEvent(() => run(() => actions.onSteer(item.id)));
  const queued = item.state === "queued";
  const failed = item.state === "failed";
  return (
    <View style={styles.root} testID={`v2-queue-item-${item.id}`}>
      {editor === null ? (
        <>
          <View style={styles.main}>
            <QueueDragHandleView
              canMoveDown={canMoveDown}
              canMoveUp={canMoveUp}
              disabled={!actionable || !queued || pending || (!canMoveUp && !canMoveDown)}
              itemId={item.id}
              onDrop={move}
              position={queuedPosition}
              total={queuedTotal}
            />
            <View style={styles.copy}>
              <ProductText numberOfLines={3} style={styles.summary}>
                {item.summary === "" ? "Queued attachment" : item.summary}
              </ProductText>
              <View style={styles.metadata}>
                <ProductText style={styles.state} tone={stateTone(item)}>
                  {stateLabel(item.state)}
                </ProductText>
                {item.attachmentCount > 0 ? (
                  <ProductText style={styles.state} tone="muted">
                    {attachmentCountLabel(item.attachmentCount)}
                  </ProductText>
                ) : null}
              </View>
            </View>
            {pending ? <ShimmerText style={styles.pending} text="Updating" /> : null}
          </View>
          <View style={styles.actions}>
            <QueueRowActionView
              disabled={!actionable || !queued || !canSteer || pending}
              icon="forward"
              label="Steer queued prompt"
              onPress={steer}
            />
            <QueueRowActionView
              disabled={!actionable || !queued || pending}
              icon="create"
              label="Edit queued prompt"
              onPress={edit}
            />
            {failed ? (
              <QueueRowActionView
                disabled={!actionable || pending}
                icon="refresh"
                label="Retry queued prompt"
                onPress={retry}
              />
            ) : null}
            <QueueRowActionView
              destructive
              disabled={!actionable || (!queued && !failed) || pending}
              icon="close"
              label="Delete queued prompt"
              onPress={cancel}
            />
          </View>
        </>
      ) : (
        editor
      )}
      {item.error === null ? null : (
        <ProductText style={styles.error} tone="danger">
          {item.error}
        </ProductText>
      )}
      {actionError === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
          {actionError}
        </ProductText>
      )}
    </View>
  );
}

function stateLabel(state: QueueRowModel["state"]): string {
  if (state === "running") return "Sending";
  if (state === "failed") return "Failed";
  if (state === "uncertain") return "Delivery uncertain";
  return "Queued";
}

function attachmentCountLabel(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

function stateTone(item: QueueRowModel): "danger" | "muted" | "warning" {
  if (item.state === "failed") return "danger";
  if (item.state === "uncertain") return "warning";
  return "muted";
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  copy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  error: { ...typeScale.label },
  main: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  metadata: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  pending: { ...typeScale.caption },
  root: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  state: { ...typeScale.caption },
  summary: { ...typeScale.body },
});
