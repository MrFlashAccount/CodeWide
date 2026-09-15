/** V1 ReviewTargetSheet owner, extracted without changing interaction or resource lifetime. */
import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.147.0/v2";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { colors } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ReviewTargetSheet.styles";

export function ReviewSheet({
  visible,
  onClose,
  embedded = false,
  onStartReview,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
}) {
  const [targetType, setTargetType] = useState<ReviewTarget["type"]>("uncommittedChanges");
  const [targetValue, setTargetValue] = useState("");
  const [delivery, setDelivery] = useState<ReviewDelivery>("inline");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    let target: ReviewTarget;
    try {
      target = buildReviewTarget(targetType, targetValue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid review target");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    if (onStartReview === undefined) {
      setBusy(false);
      setError("Review is unavailable for this conversation");
      return;
    }
    const operation = onStartReview(target, delivery);
    void operation
      .then(
        (reviewThreadId) => {
          setResult(
            delivery === "detached"
              ? `Review started in ${reviewThreadId}`
              : "Inline review started",
          );
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not start review");
        },
      )
      .then(() => setBusy(false));
  };
  const needsValue = targetType !== "uncommittedChanges";
  const content = (
    <>
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Review</Text>
          <View style={styles.flex} />
        </View>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.controlSectionLabel}>Review target</Text>
        <ControlOption
          title="Uncommitted changes"
          selected={targetType === "uncommittedChanges"}
          onPress={() => {
            setTargetType("uncommittedChanges");
            setTargetValue("");
          }}
        />
        <ControlOption
          title="Base branch"
          selected={targetType === "baseBranch"}
          onPress={() => setTargetType("baseBranch")}
        />
        <ControlOption
          title="Commit"
          selected={targetType === "commit"}
          onPress={() => setTargetType("commit")}
        />
        <ControlOption
          title="Custom instructions"
          selected={targetType === "custom"}
          onPress={() => setTargetType("custom")}
        />
        {needsValue && (
          <TextInput
            voiceInput={targetType === "custom"}
            accessibilityLabel="Review target value"
            multiline={targetType === "custom"}
            value={targetValue}
            onChangeText={setTargetValue}
            placeholder={
              targetType === "baseBranch"
                ? "main"
                : targetType === "commit"
                  ? "commit SHA"
                  : "What should the review focus on?"
            }
            placeholderTextColor={colors.textDim}
            style={[styles.fieldInput, targetType === "custom" && { minHeight: 76 }]}
          />
        )}
        <Text style={styles.controlSectionLabel}>Delivery</Text>
        <SegmentedControl
          appearance="dark"
          values={["Inline", "New thread"]}
          selectedIndex={delivery === "inline" ? 0 : 1}
          onValueChange={(value) => setDelivery(value === "New thread" ? "detached" : "inline")}
          style={styles.modeSelector}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start review"
          disabled={busy || (needsValue && targetValue.trim() === "")}
          onPress={() => void start()}
          style={[
            styles.primaryButton,
            (busy || (needsValue && targetValue.trim() === "")) && styles.disabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>{busy ? "Starting…" : "Start review"}</Text>
        </Pressable>
        {result !== null && <Text style={styles.successText}>{result}</Text>}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close review controls",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      {content}
    </AppSheet>
  );
}

export function buildReviewTarget(type: ReviewTarget["type"], rawValue: string): ReviewTarget {
  const value = rawValue.trim();
  if (type === "uncommittedChanges") return { type };
  if (value === "") throw new Error("Review target is required");
  if (type === "baseBranch") return { type, branch: value };
  if (type === "commit") return { type, sha: value, title: null };
  return { type, instructions: value };
}
