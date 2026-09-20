import { isProtocolRecord } from "../protocol/protocolValue";
import { UserImageTile } from "./UserImageTile";
/** V1 UserMessageContent owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import { MessageAttachmentCard } from "../../../rendering/MessageAttachmentCard";
import { MessageAttachmentGrid } from "../../../rendering/MessageAttachmentTile";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { SearchHighlightQuery } from "../../../rendering/SearchMessageFocus";
import { TwoRowHorizontalScroller } from "../../../rendering/TwoRowHorizontalScroller";
import {
  projectUserMessageAttachments,
  type UserMessageAttachment,
} from "../../../rendering/user-message-attachments";
import { normalizeUserMessage } from "../../../rendering/user-message-normalizer";
import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { usePersistentExpansion } from "./Card";
import { styles } from "./UserMessageContent.styles";

export const USER_MESSAGE_COLLAPSED_LINES = 25;

export const USER_MESSAGE_COLLAPSED_CHARS = 1800;

export interface UserMessageContentProps {
  content: unknown[];
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  localAttachments?: readonly StoredDraftAttachment[];
  pendingText?: boolean;
  projectedAttachments?: unknown;
}

export function UserMessageContent(props: UserMessageContentProps) {
  const {
    content,
    getTransferAccess,
    localAttachments = [],
    pendingText = false,
    projectedAttachments,
  } = props;
  const parts = content.flatMap((raw) => (isProtocolRecord(raw) ? [raw] : []));
  const attachments = projectUserMessageAttachments(
    content,
    projectedAttachments,
    localAttachments,
  );
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const otherAttachments = attachments.filter((attachment) => attachment.kind !== "image");
  const bodyParts = parts.filter(
    (part) =>
      !["image", "localImage", "audio", "localAudio", "mention"].includes(
        typeof part.type === "string" ? part.type : "",
      ),
  );
  const bodyPartOccurrences = new Map<string, number>();
  return (
    <View style={userMessageContentStyle(imageAttachments.length)}>
      {imageAttachments.length > 0 && (
        <UserImageGallery
          attachments={imageAttachments}
          separatedFromBody={bodyParts.length > 0}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      )}
      {bodyParts.map((part, index) => {
        const type = typeof part.type === "string" ? part.type : "unknown";
        const key = occurrenceKey(bodyPartOccurrences, userMessagePartIdentity(part, type));
        if (type === "text" && typeof part.text === "string") {
          const normalized = normalizeUserMessage(part.text);
          return normalized.text === "" ? null : (
            <CollapsibleUserMessage
              key={key}
              partIndex={index}
              pending={pendingText}
              text={normalized.text}
            />
          );
        }
        const label =
          type === "skill" && typeof part.name === "string"
            ? `Skill · ${part.name}`
            : `Attachment · ${type}`;
        return (
          <View key={key} style={styles.attachmentChip}>
            <Ionicons color={colors.textMuted} name="attach-outline" size={iconSize.inline} />
            <Text numberOfLines={1} style={styles.attachmentText}>
              {label}
            </Text>
          </View>
        );
      })}
      {otherAttachments.length > 0 && (
        <MessageAttachmentGrid style={userMessageAttachmentGridStyle(bodyParts.length)}>
          {otherAttachments.map((attachment) => (
            <MessageAttachmentCard
              attachment={attachment}
              key={`${attachment.kind}:${attachment.name}:${userMessageAttachmentReference(attachment)}`}
              {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
            />
          ))}
        </MessageAttachmentGrid>
      )}
    </View>
  );
}

function userMessagePartIdentity(part: Record<string, unknown>, type: string): string {
  if (typeof part.id === "string") {
    return `${type}:id:${part.id}`;
  }
  for (const field of ["text", "name", "path", "url"] as const) {
    const value = part[field];
    if (typeof value === "string") {
      return `${type}:${field}:${textFingerprint(value)}`;
    }
  }
  return type;
}

export interface CollapsibleUserMessageProps {
  partIndex: number;
  pending?: boolean;
  text: string;
}

export function CollapsibleUserMessage(props: CollapsibleUserMessageProps) {
  const { partIndex, pending = false, text } = props;
  const highlighted = useContext(SearchHighlightQuery) !== "";
  const canCollapse =
    !highlighted &&
    (text.length > USER_MESSAGE_COLLAPSED_CHARS ||
      text.split("\n").length > USER_MESSAGE_COLLAPSED_LINES);
  const [expanded, setExpanded] = usePersistentExpansion(
    `user-message:${String(partIndex)}:${textFingerprint(text)}`,
    false,
  );
  const maxLines = !expanded && canCollapse ? USER_MESSAGE_COLLAPSED_LINES : 0;
  return (
    <View style={styles.userMessageTextBlock}>
      {pending ? (
        <WaveText
          containerStyle={styles.pendingUserMessageShimmer}
          numberOfLines={maxLines}
          style={styles.userBubbleText}
          testID="pending-user-message-shimmer"
          text={text}
        />
      ) : (
        <RichMarkdown
          source={text}
          {...(!expanded && canCollapse ? { maxLines: USER_MESSAGE_COLLAPSED_LINES } : {})}
        />
      )}
      {canCollapse && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setExpanded((current) => !current);
          }}
          style={styles.userMessageExpandButton}
        >
          <Text style={styles.userMessageExpandText}>
            {expanded ? "Collapse" : "Show full message"}
          </Text>
          <Ionicons
            color={colors.textMuted}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={iconSize.inline}
          />
        </Pressable>
      )}
    </View>
  );
}

export function userMessageAttachmentReference(attachment: UserMessageAttachment): string {
  const source = attachment.source;
  if (source.type === "path") {
    return source.path;
  }
  if (source.type === "content") {
    return source.asset.id;
  }
  if (source.type === "url") {
    return source.url;
  }
  return `${source.rootId}:${source.path}`;
}

export function UserImageGallery({
  attachments,
  getTransferAccess,
  separatedFromBody = false,
}: {
  attachments: UserMessageAttachment[];
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  separatedFromBody?: boolean;
}) {
  const tiles = attachments.map((attachment, index) => (
    <UserImageTile
      attachment={attachment}
      attachmentCount={attachments.length}
      getTransferAccess={getTransferAccess}
      index={index}
      key={userMessageAttachmentReference(attachment)}
    />
  ));
  const galleryStyle = [
    styles.userImageGallery,
    separatedFromBody && styles.userImageSeparatedFromBody,
  ];
  return attachments.length === 1 ? (
    <View style={galleryStyle} testID="user-image-gallery">
      {tiles}
    </View>
  ) : (
    <TwoRowHorizontalScroller items={tiles} style={galleryStyle} testID="user-image-gallery" />
  );
}

function userMessageContentStyle(imageAttachmentCount: number): StyleProp<ViewStyle> {
  const contentStyles: ViewStyle[] = [styles.userMessageContent];
  if (imageAttachmentCount > 0) {
    contentStyles.push(styles.userMessageMediaContent);
  }
  return contentStyles;
}

function userMessageAttachmentGridStyle(bodyPartCount: number): StyleProp<ViewStyle> {
  return bodyPartCount > 0 ? styles.userMessageAttachmentGridSeparated : undefined;
}
