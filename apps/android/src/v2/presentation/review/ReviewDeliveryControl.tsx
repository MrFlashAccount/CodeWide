import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../theme";
import type { ReviewDelivery } from "../../rendering/review/reviewModel";
import { ProductText } from "../text/ProductText";

interface ReviewDeliveryControlProps {
  deliveries: readonly ReviewDelivery[];
  onChange(delivery: ReviewDelivery): void;
  value: ReviewDelivery;
}

export function ReviewDeliveryControl(props: ReviewDeliveryControlProps): React.JSX.Element {
  const { deliveries, onChange, value } = props;
  return (
    <View accessibilityRole="radiogroup" style={styles.root}>
      {deliveries.includes("inline") ? (
        <DeliveryOption
          delivery="inline"
          label="Inline"
          onChange={onChange}
          selected={value === "inline"}
        />
      ) : null}
      {deliveries.includes("detached") ? (
        <DeliveryOption
          delivery="detached"
          label="New thread"
          onChange={onChange}
          selected={value === "detached"}
        />
      ) : null}
    </View>
  );
}

interface DeliveryOptionProps {
  delivery: ReviewDelivery;
  label: string;
  onChange(delivery: ReviewDelivery): void;
  selected: boolean;
}

function DeliveryOption(props: DeliveryOptionProps): React.JSX.Element {
  const { delivery, label, onChange, selected } = props;
  const select = useEvent(() => onChange(delivery));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={select}
      style={[styles.option, selected && styles.selected]}
    >
      <ProductText style={styles.label} tone={selected ? "default" : "muted"}>
        {label}
      </ProductText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { textAlign: "center", ...typeScale.label },
  option: {
    borderRadius: radii.pill,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  root: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.pill,
    flexDirection: "row",
    padding: spacing.optical,
  },
  selected: { backgroundColor: colors.surfaceHover },
});
