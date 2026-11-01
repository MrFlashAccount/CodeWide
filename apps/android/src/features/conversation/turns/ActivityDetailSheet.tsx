import type { RenderBlock } from "@codewide/renderers";
import { useContext, useState, type ReactElement } from "react";
import { View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { AppList } from "../../../ui/AppList";
import { useAppListItemState } from "../../../ui/appListItemContext";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import { ActivityProtocolListRow } from "../protocol/ActivityProtocolListRow";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { protocolActivityRow, protocolBlockUsesCard } from "../protocol/protocolActivityRow";
import { WebSearchProtocolBlock } from "../protocol/WebSearchProtocolBlock";
import { webSearchSummary } from "../protocol/webSearchPresentation";
import { isToolCallRunning } from "./activeToolCall";
import { styles } from "./ActivityDetailSheet.styles";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  ToolCardPlacementContext,
  TurnActivityContentContext,
  TurnActivityMetricsContext,
} from "./turnContexts";
import type { TransferAccess } from "../../../data/private-transfer";

type WebSearchBlock = RenderBlock & { readonly kind: "webSearch" };

/** Keeps detailed historical activity outside the conversation scroll owner. */
export function ActivityDetailSheet({
  blocks,
  getTransferAccess,
  onClose,
  onFixUnsupportedBlock,
  turnKey,
  turnStatus,
  visible,
}: {
  blocks: readonly RenderBlock[];
  getTransferAccess?: () => Promise<TransferAccess>;
  onClose: () => void;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  visible: boolean;
}): ReactElement {
  const [webSearchBlock, setWebSearchBlock] = useState<WebSearchBlock | null>(null);
  const openWebSearch = useEvent((block: WebSearchBlock) => {
    setWebSearchBlock(block);
  });
  const closeWebSearch = useEvent(() => {
    setWebSearchBlock(null);
  });
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      setWebSearchBlock(null);
      onClose();
    }
  });
  const content = (
    <ActivityDetailList
      blocks={blocks}
      onOpenWebSearch={openWebSearch}
      turnKey={turnKey}
      turnStatus={turnStatus}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  );
  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close activity details",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["70%", "90%"],
      }}
      isOpen={visible}
      onOpenChange={changeOpen}
    >
      <ActivityDetailHeader />
      {content}
      <WebSearchDetailSheet block={webSearchBlock} onClose={closeWebSearch} />
    </AppSheet>
  );
}

function ActivityDetailHeader(): ReactElement {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        Activity
      </Text>
    </View>
  );
}

function ActivityDetailList({
  blocks,
  getTransferAccess,
  onFixUnsupportedBlock,
  onOpenWebSearch,
  turnKey,
  turnStatus,
}: {
  blocks: readonly RenderBlock[];
  getTransferAccess?: () => Promise<TransferAccess>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onOpenWebSearch: (block: WebSearchBlock) => void;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
}): ReactElement {
  const renderItem = ({ item: block }: { item: RenderBlock }) => (
    <ActivityDetailRow
      block={block}
      onOpenWebSearch={onOpenWebSearch}
      turnKey={turnKey}
      turnStatus={turnStatus}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  );
  const list = (
    <AppList
      contentContainerStyle={styles.content}
      data={blocks}
      keyboardShouldPersistTaps="handled"
      keyExtractor={activityBlockKey}
      renderItem={renderItem}
      scrollComponent={AppSheetScrollView}
      testID="activity-detail-list"
      virtualized
    />
  );
  return <TurnActivityContentContext.Provider value>{list}</TurnActivityContentContext.Provider>;
}

function ActivityDetailRow({
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
  onOpenWebSearch,
  turnKey,
  turnStatus,
}: {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onOpenWebSearch: (block: WebSearchBlock) => void;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
}): ReactElement {
  const { isLast } = useAppListItemState();
  return (
    <ActiveActivityDetailRow
      active={turnStatus === "inProgress" && isToolCallRunning(block, isLast)}
      block={block}
      itemKey={`${turnKey}:${block.key}`}
      onOpenWebSearch={onOpenWebSearch}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  );
}

type ActivityDetailRowContentProps = {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
  itemKey: string;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  onOpenWebSearch: (block: WebSearchBlock) => void;
};

function ActiveActivityDetailRow({
  active,
  ...props
}: ActivityDetailRowContentProps & { active: boolean }): ReactElement {
  return (
    <ActiveToolCallContext.Provider value={active}>
      <ActivityDetailExpansion {...props} />
    </ActiveToolCallContext.Provider>
  );
}

function ActivityDetailExpansion(props: ActivityDetailRowContentProps): ReactElement {
  return (
    <ExpansionItemKeyContext.Provider value={props.itemKey}>
      <ActivityDetailContent {...props} />
    </ExpansionItemKeyContext.Provider>
  );
}

function ActivityDetailContent({
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
  onOpenWebSearch,
}: ActivityDetailRowContentProps): ReactElement {
  const metrics = useContext(TurnActivityMetricsContext);
  const row = protocolActivityRow(block, metrics);
  const openDetail = useEvent(() => {
    if (isWebSearchBlock(block)) {
      onOpenWebSearch(block);
    }
  });
  const content = protocolBlockUsesCard(block) ? (
    <ProtocolBlock
      block={block}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  ) : (
    <ActivityProtocolListRow block={block} />
  );
  return (
    <View style={styles.row}>
      <ToolCardPlacementContext.Provider
        value={{ description: row.description, kind: "sheet", openDetail }}
      >
        {content}
      </ToolCardPlacementContext.Provider>
    </View>
  );
}

function activityBlockKey(block: RenderBlock): string {
  return block.key;
}

function isWebSearchBlock(block: RenderBlock): block is WebSearchBlock {
  return block.kind === "webSearch";
}

function WebSearchDetailSheet({
  block,
  onClose,
}: {
  block: WebSearchBlock | null;
  onClose: () => void;
}): ReactElement {
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close web search results",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["70%", "90%"],
      }}
      isOpen={block !== null}
      onOpenChange={changeOpen}
    >
      {block === null ? null : <WebSearchDetailContent block={block} />}
    </AppSheet>
  );
}

function WebSearchDetailContent({ block }: { block: WebSearchBlock }): ReactElement {
  const { query, resultCount } = webSearchSummary(block);
  return (
    <>
      <View style={styles.webSearchHeader}>
        <Text style={styles.webSearchLabelText}>Web search</Text>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.webSearchQuery}>
          {query}
        </Text>
        <Text style={styles.webSearchCount}>{webSearchResultCountLabel(resultCount)}</Text>
      </View>
      <AppSheetScrollView contentContainerStyle={styles.detailContent}>
        <WebSearchDetailBody block={block} />
      </AppSheetScrollView>
    </>
  );
}

function webSearchResultCountLabel(resultCount: number): string {
  if (resultCount === 0) {
    return "No results";
  }
  return `${String(resultCount)} ${resultCount === 1 ? "result" : "results"}`;
}

function WebSearchDetailBody({ block }: { block: WebSearchBlock }): ReactElement {
  return (
    <ToolCardPlacementContext.Provider value={{ kind: "sheetDetail" }}>
      <WebSearchProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>
  );
}
