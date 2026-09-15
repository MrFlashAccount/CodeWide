/** V1 OptimisticTurn owner, extracted without changing interaction or resource lifetime. */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import { type GetTransferAccess } from "../../../data/private-transfer";
import { Bubble, BubbleContent } from "../../../rendering/Bubble";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { colors } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { CalmSpinner } from "../../../ui/CalmSpinner";
import { InlineIcon } from "../../../ui/InlineIcon";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { type TimelineItem } from "../timeline/timelineTypes";
import { styles } from "./OptimisticTurn.styles";
import { UserMessageContent } from "./UserMessageContent";

export interface OptimisticTurnProps {
  item: Extract<TimelineItem, { kind: "optimistic" }>;
  onRetry?(commandId: string): Promise<void>;
  getTransferAccess?: GetTransferAccess;
}

export function OptimisticTurn(props: OptimisticTurnProps) {
  const { getTransferAccess, item, onRetry } = props;
  const failed = item.status === "failed";
  const deliveryLabel = failed
    ? "Failed"
    : item.status === "uncertain"
      ? "Checking delivery"
      : item.status === "appServerAccepted"
        ? "Running"
        : item.status === "companionAccepted"
          ? item.workspaceRequestId !== null && item.workspaceRequestId !== undefined
            ? "Preparing workspace"
            : "Accepted by Companion"
          : item.status === "sending"
            ? "Sending to Companion"
            : "Queued";
  const [retrying, setRetrying] = useState(false);
  const dialog = useAppDialog();
  const retry = () => {
    if (onRetry === undefined || retrying) return;
    setRetrying(true);
    void onRetry(item.id).catch((cause: unknown) => {
      setRetrying(false);
      dialog.alert(
        "Retry failed",
        cause instanceof Error ? cause.message : "Could not retry message",
      );
    });
  };
  return (
    <View testID="turn-group" style={styles.turnGroup}>
      <View style={styles.userTurnCluster}>
        <RecoverableRenderBoundary
          scope="bubble"
          label="Pending user message"
          context={`Delivery: ${item.id}`}
          resetKey={`${item.scope}:${item.id}`}
        >
          <ImagePreviewGroup id={`${item.scope}:${item.id}:user`}>
            <View
              accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
              style={styles.userMessageRow}
            >
              <Bubble
                variant="user"
                testID="user-bubble"
                errorLabel="Pending user message"
                errorContext={`Delivery: ${item.id}`}
                errorResetKey={`${item.scope}:${item.id}`}
              >
                <BubbleContent>
                  <UserMessageContent
                    content={item.text === "" ? [] : [{ type: "text", text: item.text }]}
                    localAttachments={item.attachments}
                    pendingText={!failed}
                    {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  />
                </BubbleContent>
              </Bubble>
              <Text testID="user-message-time" style={styles.messageTime}>
                {formatClockTime(item.createdAt / 1_000)}
              </Text>
            </View>
          </ImagePreviewGroup>
        </RecoverableRenderBoundary>
        {failed ? (
          <View
            accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
            testID="optimistic-turn-footer"
            style={[styles.turnFooter, styles.turnFooterEnd]}
          >
            <View style={[styles.turnStatusDot, styles.turnStatusFailed]} />
            <Text style={styles.turnMetaText}>{deliveryLabel}</Text>
            {onRetry !== undefined && (
              <Pressable
                accessibilityLabel="Retry message"
                disabled={retrying}
                hitSlop={7}
                onPress={retry}
                style={({ pressed }) => [
                  styles.retryMessageButton,
                  pressed && styles.pressed,
                  retrying && styles.disabled,
                ]}
              >
                {retrying ? (
                  <CalmSpinner size={9} color={colors.textMuted} durationMs={1_400} />
                ) : (
                  <InlineIcon name="refresh" role="label" color={colors.accent} />
                )}
                <Text style={styles.retryMessageText}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        {failed && (
          <Text accessibilityLiveRegion="polite" selectable style={styles.optimisticError}>
            {item.lastError === null
              ? "Message was rejected. Edit it and retry."
              : `Message was rejected: ${item.lastError}`}
          </Text>
        )}
      </View>
    </View>
  );
}
