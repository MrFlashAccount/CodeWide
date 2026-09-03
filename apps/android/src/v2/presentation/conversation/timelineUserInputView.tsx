import { useState, useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import { PresentationText as Text, ProductText } from "../text/ProductText";
import { CollapsibleUserText } from "./collapsibleUserText";
import type {
  TimelineActivityActions,
  TimelineActivityAttachment,
  TimelineDisplayUserBlock,
} from "./timelineTypes";

interface TimelineUserInputViewProps {
  actions?: TimelineActivityActions;
  blocks: TimelineDisplayUserBlock[];
}

interface TimelineUserInputBlockViewProps {
  actions: TimelineActivityActions | undefined;
  block: TimelineDisplayUserBlock;
}

interface UserAttachmentBlockProps {
  actions?: TimelineActivityActions;
  attachment: TimelineActivityAttachment | null;
  displayName?: string;
  fallbackLabel: string;
  fallbackSecondary: string;
  image: boolean;
}

interface UserInputChipProps {
  accessibilityLabel: string;
  label: string;
  onPress?(): Promise<void> | void;
  secondary?: string;
}

interface TimelineUserInputEntry {
  block: TimelineDisplayUserBlock;
  key: string;
}

export function TimelineUserInputView(props: TimelineUserInputViewProps): React.JSX.Element {
  const { actions, blocks } = props;
  return (
    <View style={styles.blocks} testID="user-input-blocks">
      {userInputEntries(blocks).map((entry) => (
        <TimelineUserInputBlockView actions={actions} key={entry.key} block={entry.block} />
      ))}
    </View>
  );
}

function TimelineUserInputBlockView(props: TimelineUserInputBlockViewProps): React.JSX.Element {
  const { actions, block } = props;
  switch (block.kind) {
    case "text":
      return <CollapsibleUserText text={block.text} />;
    case "image":
    case "localImage":
      return (
        <UserAttachmentBlock
          {...(actions === undefined ? {} : { actions })}
          attachment={block.attachment}
          fallbackLabel="Image unavailable"
          fallbackSecondary={block.reference}
          image
        />
      );
    case "audio":
    case "localAudio":
      return (
        <UserAttachmentBlock
          {...(actions === undefined ? {} : { actions })}
          attachment={block.attachment}
          fallbackLabel="Audio unavailable"
          fallbackSecondary={block.reference}
          image={false}
        />
      );
    case "skill":
      return (
        <UserInputChip
          accessibilityLabel={`Skill ${block.name}`}
          label={`Skill · ${block.name}`}
          secondary={block.path}
        />
      );
    case "mention":
      return block.attachment === null ? (
        <UserInputChip
          accessibilityLabel={`Attachment ${block.name}`}
          label={block.name}
          secondary={block.path}
        />
      ) : (
        <UserAttachmentBlock
          {...(actions === undefined ? {} : { actions })}
          attachment={block.attachment}
          displayName={block.name}
          fallbackLabel={block.name}
          fallbackSecondary={block.reference}
          image={block.attachment.mediaType.toLowerCase().startsWith("image/")}
        />
      );
    default:
      return unreachableUserBlock(block);
  }
}

function UserAttachmentBlock(props: UserAttachmentBlockProps): React.JSX.Element {
  const { actions, attachment, displayName, fallbackLabel, fallbackSecondary, image } = props;
  const openAttachment = actions?.onOpenAttachment;
  const open = useEvent(async (): Promise<void> => {
    if (attachment === null) return;
    await openAttachment?.(attachment.id);
  });
  if (attachment === null) {
    return (
      <UserInputChip
        accessibilityLabel={fallbackLabel}
        label={fallbackLabel}
        secondary={fallbackSecondary}
      />
    );
  }
  const label = displayName ?? attachment.name;
  return (
    <View style={styles.attachment}>
      {image && attachment.downloadUrl !== null ? (
        <RichMarkdown source={`![${escapeMarkdown(label)}](${attachment.downloadUrl})`} />
      ) : null}
      <UserInputChip
        accessibilityLabel={`Open attachment ${label}`}
        label={label}
        {...(openAttachment === undefined ? {} : { onPress: open })}
        secondary={attachment.mediaType}
      />
    </View>
  );
}

function UserInputChip(props: UserInputChipProps): React.JSX.Element {
  const { accessibilityLabel, label, onPress, secondary } = props;
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const activate = useEvent(() => {
    if (onPress === undefined) return;
    setError(null);
    startAction(async () => {
      try {
        await onPress();
      } catch {
        setError("Could not open this attachment.");
      }
    });
  });
  return (
    <View style={styles.chipGroup}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={onPress === undefined ? "text" : "button"}
        accessibilityState={{ busy: pending, disabled: onPress === undefined || pending }}
        disabled={onPress === undefined || pending}
        onPress={activate}
        style={styles.chip}
      >
        <Text numberOfLines={1} style={styles.label}>
          {pending ? "Opening…" : label}
        </Text>
        {secondary === undefined ? null : (
          <ProductText numberOfLines={1} style={styles.secondary} tone="dim">
            {secondary}
          </ProductText>
        )}
      </Pressable>
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" tone="danger">
          {error}
        </ProductText>
      )}
    </View>
  );
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\[\]]/gu, String.raw`\$&`);
}

function userInputEntries(blocks: TimelineDisplayUserBlock[]): TimelineUserInputEntry[] {
  const occurrences = new Map<string, number>();
  return blocks.map((block) => {
    const identity = userInputIdentity(block);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { block, key: `${identity}:${String(occurrence)}` };
  });
}

function userInputIdentity(block: TimelineDisplayUserBlock): string {
  switch (block.kind) {
    case "text":
      return `text:${block.text}`;
    case "image":
    case "localImage":
    case "audio":
    case "localAudio":
      return `${block.kind}:${block.reference}`;
    case "skill":
      return `skill:${block.name}:${block.path}`;
    case "mention":
      return `mention:${block.name}:${block.path}`;
    default:
      return unreachableUserBlock(block);
  }
}

function unreachableUserBlock(value: never): never {
  throw new Error(`Unsupported timeline user block: ${String(value)}`);
}

const styles = StyleSheet.create({
  attachment: { gap: spacing.xs, minWidth: 0 },
  blocks: { gap: spacing.xs, minWidth: 0 },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.small,
    gap: spacing.optical,
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipGroup: { alignSelf: "flex-start", gap: spacing.xxs, maxWidth: "100%", minWidth: 0 },
  label: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  secondary: { ...typeScale.caption },
});
