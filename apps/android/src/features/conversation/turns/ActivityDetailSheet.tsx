import type { RenderBlock } from "@codewide/renderers";
import { LegendList } from "@legendapp/list/react-native";
import type { ReactElement } from "react";
import { View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { styles } from "./ActivityDetailSheet.styles";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  TurnActivityContentContext,
} from "./turnContexts";

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
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onClose: () => void;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  visible: boolean;
}): ReactElement {
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  const content = (
    <ActivityDetailList
      blocks={blocks}
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
  turnKey,
  turnStatus,
}: {
  blocks: readonly RenderBlock[];
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
}): ReactElement {
  const renderItem = ({ index, item: block }: { index: number; item: RenderBlock }) => (
    <ActivityDetailRow
      active={turnStatus === "inProgress" && index === blocks.length - 1}
      block={block}
      turnKey={turnKey}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  );
  const list = (
    <LegendList
      contentContainerStyle={styles.content}
      data={blocks}
      drawDistance={300}
      estimatedItemSize={180}
      keyboardShouldPersistTaps="handled"
      keyExtractor={activityBlockKey}
      recycleItems={false}
      renderItem={renderItem}
      renderScrollComponent={AppSheetScrollView}
    />
  );
  return <TurnActivityContentContext.Provider value>{list}</TurnActivityContentContext.Provider>;
}

function ActivityDetailRow({
  active,
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
  turnKey,
}: {
  active: boolean;
  block: RenderBlock;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
}): ReactElement {
  return (
    <ActiveActivityDetailRow
      active={active}
      block={block}
      itemKey={`${turnKey}:${block.key}`}
      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
    />
  );
}

type ActivityDetailRowContentProps = {
  block: RenderBlock;
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  itemKey: string;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
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
}: ActivityDetailRowContentProps): ReactElement {
  return (
    <View style={styles.row}>
      <ProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
      />
    </View>
  );
}

function activityBlockKey(block: RenderBlock): string {
  return block.key;
}
