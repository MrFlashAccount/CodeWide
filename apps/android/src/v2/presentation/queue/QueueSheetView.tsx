import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { QueueItemRowView } from "./QueueItemRowView";
import type { QueuePagingModel, QueueRowActions, QueueRowModel } from "./queueTypes";

export interface QueueSheetViewProps {
  actionable?: boolean;
  actions: QueueRowActions;
  activeTurnId: string | null;
  items: QueueRowModel[];
  editor: ReactNode;
  editingItemId: string | null;
  onClose(): void;
  onEditRequest(itemId: string): void;
  paging?: QueuePagingModel;
  visible: boolean;
}

export function QueueSheetView(props: QueueSheetViewProps): React.JSX.Element {
  const {
    actionable = true,
    actions,
    activeTurnId,
    editor,
    editingItemId,
    items,
    onClose,
    onEditRequest,
    paging = COMPLETE_PAGING,
    visible,
  } = props;
  const requestEdit = useEvent((itemId: string) => onEditRequest(itemId));
  const queuedIds = collectQueuedIds(items);
  const onOpenChange = useEvent((open: boolean) => {
    if (!open) onClose();
  });
  const renderItem = (item: QueueRowModel) => (
    <QueueItemRowView
      actionable={actionable}
      actions={actions}
      canMoveDown={canMove(queuedIds, item.id, 1, paging.status !== "complete")}
      canMoveUp={canMove(queuedIds, item.id, -1)}
      canSteer={activeTurnId !== null}
      editor={item.id === editingItemId ? editor : null}
      item={item}
      key={item.id}
      onEditRequest={requestEdit}
      queuedPosition={queuedPosition(queuedIds, item.id)}
      queuedTotal={queuedIds.length}
    />
  );
  return (
    <PresentationSheetView contentProps={SHEET_PROPS} isOpen={visible} onOpenChange={onOpenChange}>
      <View style={styles.root} testID="v2-queue-manager">
        <View style={styles.header}>
          <View style={styles.heading}>
            <ProductText style={styles.title} weight="semibold">
              Queued prompts
            </ProductText>
            <ProductText style={styles.subtitle} tone="muted">
              {queueSubtitle(items.length, paging.status !== "complete")}
            </ProductText>
          </View>
          <Pressable
            accessibilityLabel="Close queued prompts"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.close}
          >
            <PresentationIcon color={colors.text} name="close" size={21} />
          </Pressable>
        </View>
        <PresentationSheetScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <PresentationIcon color={colors.textDim} name="list" size={28} />
              <ProductText tone="muted">Nothing is waiting for this thread.</ProductText>
            </View>
          ) : (
            <>
              {items.map(renderItem)}
              <QueuePagingView paging={paging} />
            </>
          )}
        </PresentationSheetScrollView>
      </View>
    </PresentationSheetView>
  );
}

function queuedPosition(ids: string[], itemId: string): number {
  const index = ids.indexOf(itemId);
  return index < 0 ? 1 : index + 1;
}

function collectQueuedIds(items: QueueRowModel[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.state === "queued") ids.push(item.id);
  }
  return ids;
}

function canMove(ids: string[], itemId: string, direction: -1 | 1, hasMore = false): boolean {
  const index = ids.indexOf(itemId);
  if (index < 0) return false;
  return direction === -1 ? index > 0 : index < ids.length - 1 || hasMore;
}

function queueSubtitle(count: number, hasMore: boolean): string {
  if (count === 0 && hasMore) return "More pending messages";
  if (hasMore) return `${count}+ pending messages`;
  if (count === 0) return "No pending messages";
  if (count === 1) return "1 pending message";
  return `${count} pending messages`;
}

interface QueuePagingViewProps {
  paging: QueuePagingModel;
}

function QueuePagingView(props: QueuePagingViewProps): React.JSX.Element | null {
  const { paging } = props;
  const loadMore = useEvent(() => {
    if (paging.status !== "ready" && paging.status !== "error") return;
    paging.loadMore().catch(() => undefined);
  });
  if (paging.status === "complete" || paging.status === "unavailable") return null;
  if (paging.status === "loading") {
    return (
      <View style={styles.pageStatus}>
        <ShimmerText text="Loading queued prompts…" />
      </View>
    );
  }
  const failed = paging.status === "error";
  return (
    <Pressable
      accessibilityLabel={failed ? "Retry loading queued prompts" : "Load more queued prompts"}
      accessibilityRole="button"
      onPress={loadMore}
      style={styles.pageStatus}
    >
      <ProductText numberOfLines={2} style={styles.pageLabel} tone={failed ? "danger" : "muted"}>
        {failed ? `${paging.message} · Retry` : "Load more"}
      </ProductText>
    </Pressable>
  );
}

const COMPLETE_PAGING: QueuePagingModel = {
  loadMore: async () => undefined,
  status: "complete",
};

const SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: { paddingBottom: spacing.xl, paddingHorizontal: spacing.md },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 180 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 62,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  heading: { flex: 1, minWidth: 0 },
  pageLabel: { textAlign: "center", ...typeScale.label },
  pageStatus: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingVertical: spacing.xs,
  },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  subtitle: { ...typeScale.caption },
  title: { ...typeScale.title },
});
