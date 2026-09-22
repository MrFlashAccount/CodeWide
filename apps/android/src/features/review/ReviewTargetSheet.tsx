/** V1 ReviewTargetSheet owner, extracted without changing interaction or resource lifetime. */
import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.155.1/v2";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { colors } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ReviewTargetSheet.styles";

export function ReviewSheet({
  embedded = false,
  onClose,
  onStartReview,
  visible,
}: {
  embedded?: boolean;
  onClose: () => void;
  onStartReview?: (target: ReviewTarget, delivery: ReviewDelivery) => Promise<string>;
  visible: boolean;
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
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid review target");
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
    operation
      .then(
        (reviewThreadId) => {
          setResult(
            delivery === "detached"
              ? `Review started in ${reviewThreadId}`
              : "Inline review started",
          );
        },
        (error: unknown) => {
          setError(error instanceof Error ? error.message : "Could not start review");
        },
      )
      .then(() => {
        setBusy(false);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not start review");
        setBusy(false);
      });
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
        contentContainerStyle={styles.menuScrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.menuScroll}
      >
        <Text style={styles.controlSectionLabel}>Review target</Text>
        <ControlOption
          onPress={() => {
            setTargetType("uncommittedChanges");
            setTargetValue("");
          }}
          selected={targetType === "uncommittedChanges"}
          title="Uncommitted changes"
        />
        <ControlOption
          onPress={() => {
            setTargetType("baseBranch");
          }}
          selected={targetType === "baseBranch"}
          title="Base branch"
        />
        <ControlOption
          onPress={() => {
            setTargetType("commit");
          }}
          selected={targetType === "commit"}
          title="Commit"
        />
        <ControlOption
          onPress={() => {
            setTargetType("custom");
          }}
          selected={targetType === "custom"}
          title="Custom instructions"
        />
        {needsValue && (
          <TextInput
            accessibilityLabel="Review target value"
            multiline={targetType === "custom"}
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
            value={targetValue}
            voiceInput={targetType === "custom"}
          />
        )}
        <Text style={styles.controlSectionLabel}>Delivery</Text>
        <SegmentedControl
          appearance="dark"
          onValueChange={(value) => {
            setDelivery(value === "New thread" ? "detached" : "inline");
          }}
          selectedIndex={delivery === "inline" ? 0 : 1}
          style={styles.modeSelector}
          values={["Inline", "New thread"]}
        />
        <Pressable
          accessibilityLabel="Start review"
          accessibilityRole="button"
          disabled={busy || (needsValue && targetValue.trim() === "")}
          onPress={start}
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
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close review controls",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["55%", "90%"],
      }}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {content}
    </AppSheet>
  );
}

function buildReviewTarget(type: ReviewTarget["type"], rawValue: string): ReviewTarget {
  const value = rawValue.trim();
  if (type === "uncommittedChanges") {
    return { type };
  }
  if (value === "") {
    throw new Error("Review target is required");
  }
  if (type === "baseBranch") {
    return { branch: value, type };
  }
  if (type === "commit") {
    return { sha: value, title: null, type };
  }
  return { instructions: value, type };
}
