import { isProtocolRecord } from "../protocol/protocolValue";
import { renderUserImageTile } from "./UserImageTile";
/** V1 UserMessageContent owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";
import { Pressable, View } from "react-native";
import { type StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import { MessageAttachmentCard } from "../../../rendering/MessageAttachmentCard";
import { MessageAttachmentGrid } from "../../../rendering/MessageAttachmentTile";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { SearchHighlightQuery } from "../../../rendering/SearchMessageFocus";
import {
  projectUserMessageAttachments,
  type UserMessageAttachment,
} from "../../../rendering/user-message-attachments";
import { normalizeUserMessage } from "../../../rendering/user-message-normalizer";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { usePersistentExpansion } from "./Card";
import { textFingerprint } from "./disclosureState";
import { styles } from "./UserMessageContent.styles";

export const USER_MESSAGE_COLLAPSED_LINES = 25;

export const USER_MESSAGE_COLLAPSED_CHARS = 1_800;

export interface UserMessageContentProps {
  content: unknown[];
  projectedAttachments?: unknown;
  localAttachments?: readonly StoredDraftAttachment[];
  pendingText?: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
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
      !["image", "localImage", "audio", "localAudio", "mention"].includes(String(part.type ?? "")),
  );
  return (
    <View
      style={[
        styles.userMessageContent,
        imageAttachments.length > 0 && styles.userMessageMediaContent,
      ]}
    >
      {imageAttachments.length > 0 && (
        <UserImageGallery
          attachments={imageAttachments}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      )}
      {bodyParts.map((part, index) => {
        const type = typeof part.type === "string" ? part.type : "unknown";
        if (type === "text" && typeof part.text === "string") {
          const normalized = normalizeUserMessage(part.text);
          return normalized.text === "" ? null : (
            <CollapsibleUserMessage
              key={index}
              text={normalized.text}
              partIndex={index}
              pending={pendingText}
            />
          );
        }
        const label =
          type === "skill" && typeof part.name === "string"
            ? `Skill · ${part.name}`
            : `Attachment · ${type}`;
        return (
          <View key={index} style={styles.attachmentChip}>
            <Ionicons name="attach-outline" size={iconSize.inline} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.attachmentText}>
              {label}
            </Text>
          </View>
        );
      })}
      {otherAttachments.length > 0 && (
        <MessageAttachmentGrid>
          {otherAttachments.map((attachment) => (
            <MessageAttachmentCard
              key={`${attachment.kind}:${attachment.name}:${userMessageAttachmentReference(attachment)}`}
              attachment={attachment}
              {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
            />
          ))}
        </MessageAttachmentGrid>
      )}
    </View>
  );
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
    `user-message:${partIndex}:${textFingerprint(text)}`,
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
          onPress={() => setExpanded((current) => !current)}
          style={styles.userMessageExpandButton}
        >
          <Text style={styles.userMessageExpandText}>
            {expanded ? "Collapse" : "Show full message"}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={iconSize.inline}
            color={colors.textMuted}
          />
        </Pressable>
      )}
    </View>
  );
}

export function userMessageAttachmentReference(attachment: UserMessageAttachment): string {
  const source = attachment.source;
  if (source.type === "path") return source.path;
  if (source.type === "content") return source.asset.id;
  if (source.type === "url") return source.url;
  return `${source.rootId}:${source.path}`;
}

export function UserImageGallery({
  attachments,
  getTransferAccess,
}: {
  attachments: UserMessageAttachment[];
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  return (
    <View testID="user-image-gallery" style={styles.userImageGallery}>
      {attachments.map((attachment, index) =>
        renderUserImageTile(attachment, index, attachments.length, getTransferAccess),
      )}
    </View>
  );
}
