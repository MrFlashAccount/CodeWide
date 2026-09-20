/** V1 OptimisticTurn owner, extracted without changing interaction or resource lifetime. */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import type { GetTransferAccess } from "../../../data/private-transfer";
import { Bubble, BubbleContent } from "../../../rendering/Bubble";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { colors } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { CalmSpinner } from "../../../ui/CalmSpinner";
import { InlineIcon } from "../../../ui/InlineIcon";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import type { TimelineItem } from "../timeline/timelineTypes";
import { styles } from "./OptimisticTurn.styles";
import { UserMessageContent } from "./UserMessageContent";

export interface OptimisticTurnProps {
  getTransferAccess?: GetTransferAccess;
  item: Extract<TimelineItem, { kind: "optimistic" }>;
  onRetry?: (commandId: string) => Promise<void>;
}

export function OptimisticTurn(props: OptimisticTurnProps) {
  const { getTransferAccess, item, onRetry } = props;
  const failed = item.status === "failed";
  const pending = !failed && item.status !== "appServerAccepted";
  const deliveryLabel = failed
    ? "Failed"
    : item.status === "uncertain"
      ? "Checking delivery"
      : item.status === "appServerAccepted"
        ? "Sent"
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
    if (onRetry === undefined || retrying) {
      return;
    }
    setRetrying(true);
    void onRetry(item.id).catch((error: unknown) => {
      setRetrying(false);
      dialog.alert(
        "Retry failed",
        error instanceof Error ? error.message : "Could not retry message",
      );
    });
  };
  return (
    <View style={styles.turnGroup} testID="turn-group">
      <View style={styles.userTurnCluster}>
        <RecoverableRenderBoundary
          context={`Delivery: ${item.id}`}
          label="Pending user message"
          resetKey={`${item.scope}:${item.id}`}
          scope="bubble"
        >
          <ImagePreviewGroup id={`${item.scope}:${item.id}:user`}>
            <View
              accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
              style={styles.userMessageRow}
            >
              <Bubble
                errorContext={`Delivery: ${item.id}`}
                errorLabel="Pending user message"
                errorResetKey={`${item.scope}:${item.id}`}
                testID="user-bubble"
                variant="user"
              >
                <BubbleContent>
                  <UserMessageContent
                    content={item.text === "" ? [] : [{ text: item.text, type: "text" }]}
                    localAttachments={item.attachments}
                    pendingText={pending}
                    {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  />
                </BubbleContent>
              </Bubble>
              <Text style={styles.messageTime} testID="user-message-time">
                {formatClockTime(item.createdAt / 1000)}
              </Text>
            </View>
          </ImagePreviewGroup>
        </RecoverableRenderBoundary>
        {failed ? (
          <View
            accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
            style={[styles.turnFooter, styles.turnFooterEnd]}
            testID="optimistic-turn-footer"
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
                  <CalmSpinner color={colors.textMuted} durationMs={1400} size={9} />
                ) : (
                  <InlineIcon color={colors.accent} name="refresh" role="label" />
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
