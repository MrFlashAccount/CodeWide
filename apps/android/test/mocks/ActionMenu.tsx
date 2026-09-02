import { useState, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";

interface MockAction {
  disabled?: boolean;
  id: string;
  label: string;
}

interface MockActionMenuProps extends PropsWithChildren {
  accessibilityLabel: string;
  actions: readonly MockAction[];
  onSelect(id: string): void;
}

export function ActionMenu(props: MockActionMenuProps): React.JSX.Element {
  const { accessibilityLabel, actions, children, onSelect } = props;
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)}>
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        >
          {children}
        </View>
      </Pressable>
      {open
        ? actions.map((action) => (
            <Pressable
              accessibilityLabel={`${accessibilityLabel}: ${action.label}`}
              disabled={action.disabled}
              key={action.id}
              onPress={() => onSelect(action.id)}
            >
              <Text>{action.label}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}
