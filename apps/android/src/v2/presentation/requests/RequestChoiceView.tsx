import { Pressable } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { requestStyles } from "./requestStyles";

interface RequestChoiceViewProps {
  description?: string;
  label: string;
  multiple?: boolean;
  onSelect(value: string): void;
  selected: boolean;
  value: string;
}

export function RequestChoiceView(props: RequestChoiceViewProps): React.JSX.Element {
  const { description, label, multiple = false, onSelect, selected, value } = props;
  const select = useEvent(() => onSelect(value));
  return (
    <Pressable
      android_ripple={ANDROID_RIPPLE}
      accessibilityLabel={label}
      accessibilityRole={multiple ? "checkbox" : "radio"}
      accessibilityState={multiple ? { checked: selected } : { selected }}
      onPress={select}
      style={[requestStyles.choice, selected && requestStyles.choiceSelected]}
    >
      <ProductText numberOfLines={2}>{label}</ProductText>
      {description === undefined || description === "" ? null : (
        <ProductText numberOfLines={2} tone="muted">
          {description}
        </ProductText>
      )}
      <PresentationIcon
        color={selected ? colors.accent : colors.textDim}
        name={selected ? "checkCircle" : "radio"}
        size={18}
      />
    </Pressable>
  );
}

const ANDROID_RIPPLE = { color: "rgba(255, 255, 255, 0.12)" };
