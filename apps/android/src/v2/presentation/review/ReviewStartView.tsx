import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import type {
  ReviewDelivery,
  ReviewStartKind,
  ReviewStartTarget,
} from "../../rendering/review/reviewModel";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ProductText } from "../text/ProductText";
import { ReviewDeliveryControl } from "./ReviewDeliveryControl";
import {
  isReviewTargetReady,
  ReviewTargetControl,
  type ReviewTargetInputRenderer,
} from "./ReviewTargetControl";

interface ReviewStartViewProps {
  availableKinds: readonly ReviewStartKind[];
  deliveries: readonly ReviewDelivery[];
  delivery: ReviewDelivery;
  disabled: boolean;
  onClose(): void;
  onDeliveryChange(delivery: ReviewDelivery): void;
  onSubmit(): Promise<void>;
  onTargetChange(target: ReviewStartTarget): void;
  renderCustomTargetInput?: ReviewTargetInputRenderer;
  target: ReviewStartTarget;
}

export function ReviewStartView(props: ReviewStartViewProps): React.JSX.Element {
  const {
    availableKinds,
    deliveries,
    delivery,
    disabled,
    onClose,
    onDeliveryChange,
    onSubmit,
    onTargetChange,
    renderCustomTargetInput,
    target,
  } = props;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close review setup"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
        <ProductText style={styles.title} weight="semibold">
          Start code review
        </ProductText>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ProductText style={styles.sectionTitle} tone="muted">
          Review target
        </ProductText>
        <ReviewTargetControl
          availableKinds={availableKinds}
          onChange={onTargetChange}
          target={target}
          {...(renderCustomTargetInput === undefined
            ? {}
            : { renderCustomInput: renderCustomTargetInput })}
        />
        <ProductText style={styles.sectionTitle} tone="muted">
          Delivery
        </ProductText>
        <ReviewDeliveryControl
          deliveries={deliveries}
          onChange={onDeliveryChange}
          value={delivery}
        />
        <ActionPressable
          action={{
            disabled: disabled || !isReviewTargetReady(target),
            id: "start-code-review",
            label: "Start review",
            run: onSubmit,
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: spacing.md,
    maxWidth: 720,
    padding: spacing.md,
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  root: { backgroundColor: colors.background, flex: 1 },
  sectionTitle: { ...typeScale.label, fontWeight: typeWeight.semibold },
  title: { flex: 1, ...typeScale.title },
});
