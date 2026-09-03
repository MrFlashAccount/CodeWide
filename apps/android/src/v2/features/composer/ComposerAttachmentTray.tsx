import { useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { ComposerAttachmentDraftItem } from "../../application/composer/composerAttachmentTypes";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../../presentation/icons/PresentationIcon";
import { ProductText } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";

interface ComposerAttachmentTrayProps {
  items: readonly ComposerAttachmentDraftItem[];
  onEdit?(item: ComposerAttachmentDraftItem): void;
  onRemove(id: string): void;
  onReplace(id: string): Promise<void>;
  onRetry(id: string): Promise<void>;
}

/** Renders local attachment draft state without projecting it into the conversation timeline. */
export function ComposerAttachmentTray(
  props: ComposerAttachmentTrayProps,
): React.JSX.Element | null {
  const { items, onEdit, onRemove, onReplace, onRetry } = props;
  if (items.length === 0) return null;
  return (
    <ScrollView
      accessibilityLabel="Draft attachments"
      contentContainerStyle={styles.content}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.tray}
    >
      {items.map((item) => (
        <AttachmentCard
          item={item}
          key={item.id}
          {...(onEdit === undefined ? {} : { onEdit })}
          onRemove={onRemove}
          onReplace={onReplace}
          onRetry={onRetry}
        />
      ))}
    </ScrollView>
  );
}

interface AttachmentCardProps {
  item: ComposerAttachmentDraftItem;
  onEdit?(item: ComposerAttachmentDraftItem): void;
  onRemove(id: string): void;
  onReplace(id: string): Promise<void>;
  onRetry(id: string): Promise<void>;
}

function AttachmentCard(props: AttachmentCardProps): React.JSX.Element {
  const { item, onEdit, onRemove, onReplace, onRetry } = props;
  const [pending, startTransition] = useTransition();
  const remove = useEvent(() => onRemove(item.id));
  const edit = useEvent(() => onEdit?.(item));
  const replace = useEvent(() => {
    startTransition(() => onReplace(item.id).catch(() => undefined));
  });
  const retry = useEvent(() => {
    startTransition(() => onRetry(item.id).catch(() => undefined));
  });
  return (
    <View style={styles.card}>
      <PresentationIcon
        color={item.state === "error" ? colors.red : colors.textMuted}
        name={item.mediaType.startsWith("image/") ? "layers" : "attach"}
        size={20}
      />
      <View style={styles.details}>
        <ProductText numberOfLines={1} style={styles.name} weight="medium">
          {item.name}
        </ProductText>
        <ProductText
          numberOfLines={1}
          style={styles.status}
          tone={item.state === "error" ? "danger" : "dim"}
        >
          {statusLabel(item)}
        </ProductText>
        {item.progress === null ? null : (
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{
              max: 100,
              min: 0,
              now: Math.round(item.progress * 100),
            }}
            style={styles.progressTrack}
          >
            <View
              style={[styles.progressValue, { width: `${Math.round(item.progress * 100)}%` }]}
            />
          </View>
        )}
      </View>
      <AttachmentAction
        {...primaryAction(item, onEdit !== undefined, edit, replace, retry)}
        pending={pending}
      />
      <AttachmentAction label="Remove" onPress={remove} pending={pending} />
    </View>
  );
}

interface PrimaryAttachmentAction {
  label: string;
  onPress(): void;
}

function primaryAction(
  item: ComposerAttachmentDraftItem,
  editable: boolean,
  edit: () => void,
  replace: () => void,
  retry: () => void,
): PrimaryAttachmentAction {
  if (item.state === "error") return { label: "Retry", onPress: retry };
  if (editable && item.editor !== null) return { label: "Edit", onPress: edit };
  return { label: "Replace", onPress: replace };
}

interface AttachmentActionProps {
  label: string;
  onPress(): void;
  pending: boolean;
}

function AttachmentAction(props: AttachmentActionProps): React.JSX.Element {
  const { label, onPress, pending } = props;
  return (
    <Pressable
      accessibilityLabel={`${label} attachment`}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: pending }}
      disabled={pending}
      hitSlop={spacing.xs}
      onPress={onPress}
      style={styles.action}
    >
      {pending ? (
        <ShimmerText style={styles.actionLabel} text={label} />
      ) : (
        <ProductText style={styles.actionLabel} tone="muted">
          {label === "Remove" ? "×" : label === "Retry" ? "↻" : "…"}
        </ProductText>
      )}
    </Pressable>
  );
}

function statusLabel(item: ComposerAttachmentDraftItem): string {
  if (item.state === "uploading") return `Uploading ${Math.round((item.progress ?? 0) * 100)}%`;
  if (item.state === "ready") return `${formatBytes(item.sizeBytes)} · Attached`;
  if (item.state === "error") return item.error ?? "Upload failed";
  return `${formatBytes(item.sizeBytes)} · Ready`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${kibibytes.toFixed(kibibytes < 10 ? 1 : 0)} KB`;
  return `${(kibibytes / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  action: { alignItems: "center", height: touchTarget, justifyContent: "center", minWidth: 32 },
  actionLabel: { ...typeScale.label },
  card: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 320,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  content: { gap: spacing.xs, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  details: { flex: 1, minWidth: 96 },
  name: { ...typeScale.label },
  progressTrack: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 2,
    marginTop: spacing.xxs,
    overflow: "hidden",
  },
  progressValue: { backgroundColor: colors.primary, height: 2 },
  status: { ...typeScale.caption },
  tray: { flexGrow: 0 },
});
