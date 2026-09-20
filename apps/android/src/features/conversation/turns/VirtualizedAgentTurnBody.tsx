import type { RenderBlock } from "@codewide/renderers";
import type { ReactElement } from "react";
import { View } from "react-native";
import {
  ArtifactImageReferences,
  artifactImageReferences,
} from "../../../rendering/ArtifactImageReferences";
import { BubbleContent } from "../../../rendering/Bubble";
import { ContentReviewComments } from "../../../rendering/ContentReviewHost";
import { MessageAttachmentCard } from "../../../rendering/MessageAttachmentCard";
import { MessageAttachmentGrid } from "../../../rendering/MessageAttachmentTile";
import { RichMarkdownDocumentBlockView } from "../../../rendering/RichMarkdown";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { AppText as Text } from "../../../ui/Typography";
import { styles as markdownStyles } from "../content/AgentResponseMarkdown.styles";
import { AgentResponseMarkdown } from "../content/AgentResponseMarkdown";
import { CollapsedTurnActivity, CompletedTurnHistory } from "./CompletedTurnHistory";
import { PreTurnLifecycleRows } from "./PreTurnLifecycleRows";
import { TurnActivitySegment } from "./TurnActivity";
import type { projectTurnPresentation } from "./turnProjection";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { UserImageGallery, userMessageAttachmentReference } from "./UserMessageContent";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "./virtualizedTurnTypes";

type VirtualizedAgentTurnBodyProps = {
  animateLiveUpdates: boolean;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess: TurnTimelineItemProps["getTransferAccess"];
  onFixUnsupportedBlock: ((block: RenderBlock) => Promise<void>) | undefined;
  onLoadItems: TurnTimelineItemProps["onLoadItems"];
  parts: readonly VirtualizedTurnPart[];
  placement: VirtualizedTurnPlacement;
  presentation: ReturnType<typeof projectTurnPresentation>;
  requestPrompt: TurnTimelineItemProps["requestPrompt"];
  turn: TurnTimelineItemProps["turn"];
};

export function VirtualizedAgentTurnBody(props: VirtualizedAgentTurnBodyProps): ReactElement {
  return (
    <ArtifactImageReferences.Provider value={artifactImageReferences(props.presentation.artifacts)}>
      <BubbleContent>
        {isLeadingSlice(props.placement) ? <VirtualizedTurnLead {...props} /> : null}
        <VirtualizedTurnParts {...props} />
        {isTrailingSlice(props.placement) ? <VirtualizedTurnTail {...props} /> : null}
      </BubbleContent>
    </ArtifactImageReferences.Provider>
  );
}

function VirtualizedTurnLead(props: VirtualizedAgentTurnBodyProps): ReactElement {
  const preTurn =
    props.presentation.preTurnBlocks.length === 0 ? null : (
      <PreTurnLifecycleRows
        blocks={props.presentation.preTurnBlocks}
        turnKey={props.turn.key}
        turnStatus={props.presentation.rawTurn.status}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    );
  const history =
    props.presentation.rawTurn.status === "inProgress" ? null : (
      <CompletedTurnHistory
        compact={props.compact}
        forceExpanded={props.forceExpanded}
        item={props.turn}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
        {...(props.onLoadItems === undefined ? {} : { onLoadItems: props.onLoadItems })}
      />
    );
  return (
    <>
      {preTurn}
      {history}
    </>
  );
}

function VirtualizedTurnParts(props: VirtualizedAgentTurnBodyProps): ReactElement {
  return (
    <>
      {groupVirtualizedTurnParts(props.parts).map((group) =>
        group.kind === "markdown" ? (
          <VirtualizedMarkdownGroup
            key={`markdown:${group.responseKey}`}
            parts={group.parts}
            placement={props.placement}
            presentation={props.presentation}
          />
        ) : (
          renderNonMarkdownPart(props, group.part)
        ),
      )}
    </>
  );
}

type VirtualizedMarkdownPart = Extract<VirtualizedTurnPart, { kind: "markdownBlock" }>;
type VirtualizedTurnPartGroup =
  | { kind: "markdown"; parts: VirtualizedMarkdownPart[]; responseKey: string }
  | {
      kind: "single";
      part: Exclude<VirtualizedTurnPart, { kind: "markdownBlock" }>;
    };

function groupVirtualizedTurnParts(
  parts: readonly VirtualizedTurnPart[],
): VirtualizedTurnPartGroup[] {
  const groups: VirtualizedTurnPartGroup[] = [];
  for (const part of parts) {
    const previous = groups.at(-1);
    if (
      part.kind === "markdownBlock" &&
      previous?.kind === "markdown" &&
      previous.responseKey === part.response.key
    ) {
      previous.parts.push(part);
    } else if (part.kind === "markdownBlock") {
      groups.push({ kind: "markdown", parts: [part], responseKey: part.response.key });
    } else {
      groups.push({ kind: "single", part });
    }
  }
  return groups;
}

function VirtualizedMarkdownGroup({
  parts,
  placement,
  presentation,
}: {
  parts: readonly Extract<VirtualizedTurnPart, { kind: "markdownBlock" }>[];
  placement: VirtualizedTurnPlacement;
  presentation: ReturnType<typeof projectTurnPresentation>;
}): ReactElement | null {
  const first = parts[0];
  if (first === undefined) {
    return null;
  }
  const reviewTarget = presentation.agentReviewTarget;
  const comments = renderReviewComments(first, placement, presentation);
  const content = (
    <View
      style={[
        markdownStyles.agentMarkdownDocument,
        presentation.agentBubbleFill && markdownStyles.agentMarkdownDocumentFill,
        !isTrailingSlice(placement) && markdownStyles.virtualizedMarkdownBlockGap,
      ]}
    >
      {parts.map((part) => (
        <RichMarkdownDocumentBlockView
          animateStreaming={part.streaming}
          block={part.block}
          key={part.block.key}
          {...(reviewTarget === null ? {} : { reviewTarget })}
        />
      ))}
      {comments}
    </View>
  );
  const itemId = first.response.raw.id;
  return renderSearchMessage(itemId, content);
}

function renderReviewComments(
  first: VirtualizedMarkdownPart,
  placement: VirtualizedTurnPlacement,
  presentation: ReturnType<typeof projectTurnPresentation>,
): ReactElement | null {
  const reviewTarget = presentation.agentReviewTarget;
  if (
    !isTrailingSlice(placement) ||
    reviewTarget === null ||
    first.response.key !== presentation.latestAgentBlock?.key
  ) {
    return null;
  }
  return <ContentReviewComments targetId={reviewTarget.id} />;
}

function renderSearchMessage(itemId: unknown, content: ReactElement): ReactElement {
  if (typeof itemId !== "string") {
    return content;
  }
  return <SearchMessage itemId={itemId}>{content}</SearchMessage>;
}

function renderNonMarkdownPart(
  props: VirtualizedAgentTurnBodyProps,
  part: Exclude<VirtualizedTurnPart, { kind: "markdownBlock" }>,
): ReactElement | null {
  if (part.kind === "externalMarkdown") {
    return (
      <AgentResponseMarkdown
        block={part.response}
        key={`external:${part.response.key}`}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
      />
    );
  }
  if (part.kind === "activity") {
    return renderActivityPart(props, part.part);
  }
  return null;
}

function renderActivityPart(
  props: VirtualizedAgentTurnBodyProps,
  part: Extract<VirtualizedTurnPart, { kind: "activity" }>["part"],
): ReactElement {
  if (part.kind === "collapsedActivity") {
    return (
      <CollapsedTurnActivity
        compact={props.compact}
        forceExpanded={props.forceExpanded}
        indexes={part.indexes}
        item={props.turn}
        key={part.key}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
        {...(props.onFixUnsupportedBlock === undefined
          ? {}
          : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
      />
    );
  }
  return (
    <TurnActivitySegment
      animateNew={props.animateLiveUpdates}
      compact={props.compact}
      forceExpanded={props.forceExpanded}
      key={part.key}
      part={part}
      turnKey={props.turn.key}
      turnStatus={props.presentation.rawTurn.status}
      {...(props.getTransferAccess === undefined
        ? {}
        : { getTransferAccess: props.getTransferAccess })}
      {...(props.onFixUnsupportedBlock === undefined
        ? {}
        : { onFixUnsupportedBlock: props.onFixUnsupportedBlock })}
    />
  );
}

function VirtualizedTurnTail(props: VirtualizedAgentTurnBodyProps): ReactElement {
  const placeholder = props.presentation.showEmptyResponsePlaceholder ? (
    <Text style={styles.agentPlaceholder}>
      {props.presentation.rawTurn.status === "interrupted"
        ? "Stopped before response was generated"
        : "No response was generated"}
    </Text>
  ) : null;
  const thinking =
    !props.presentation.hasAgentContent && props.presentation.rawTurn.status === "inProgress" ? (
      <Text style={styles.agentPlaceholder}>Thinking</Text>
    ) : null;
  return (
    <>
      <AgentArtifacts {...props} />
      {props.requestPrompt}
      {placeholder}
      {thinking}
    </>
  );
}

function AgentArtifacts(props: VirtualizedAgentTurnBodyProps): ReactElement | null {
  if (props.presentation.artifacts.length === 0) {
    return null;
  }
  const images = props.presentation.artifacts.filter((attachment) => attachment.kind === "image");
  const attachments = props.presentation.artifacts.filter(
    (attachment) => attachment.kind !== "image",
  );
  const cards = attachments.map((attachment) => (
    <MessageAttachmentCard
      attachment={attachment}
      key={userMessageAttachmentReference(attachment)}
      {...(props.getTransferAccess === undefined ? {} : { getAccess: props.getTransferAccess })}
    />
  ));
  return (
    <View style={styles.userMessageContent} testID="agent-artifacts">
      <UserImageGallery
        attachments={images}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
      />
      {attachments.length === 0 ? null : (
        <MessageAttachmentGrid style={styles.agentAttachmentGrid}>{cards}</MessageAttachmentGrid>
      )}
    </View>
  );
}

function isLeadingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function isTrailingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "end" || placement === "single";
}
