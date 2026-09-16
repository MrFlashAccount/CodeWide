import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowPosition } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SearchFilters.styles";

interface FilterOption {
  readonly id: string;
  readonly label: string;
  readonly pinned?: boolean;
  readonly subtitle?: string;
}

export interface SelectProps {
  readonly label: string;
  readonly onChange: (id: string) => void;
  readonly options: readonly FilterOption[];
  readonly value: string;
}

export function FilterSelect(props: SelectProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    setExpanded(!expanded);
  };
  const selected = props.options.find((option) => option.id === props.value);
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable
        accessibilityLabel={`Search ${props.label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.select}
      >
        <Text numberOfLines={1} style={styles.selected}>
          {selected?.label ?? "Unavailable"}
        </Text>
        <Ionicons
          color={colors.textMuted}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
        />
      </Pressable>
      {expanded && (
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.options}>
          {props.options.map((option, index) => {
            const select = () => {
              props.onChange(option.id);
              setExpanded(false);
            };
            return (
              <AppListRow
                key={option.id}
                title={option.label}
                {...(option.subtitle === undefined ? {} : { description: option.subtitle })}
                accessibilityLabel={
                  option.pinned === true ? `${option.label}, pinned project` : option.label
                }
                multiline
                onPress={select}
                position={listRowPosition(index, props.options.length)}
                selected={props.value === option.id}
                {...(option.pinned === true
                  ? {
                      trailingIcon: {
                        color: colors.textMuted,
                        name: "pin-outline",
                        size: iconSize.inline,
                      },
                    }
                  : {})}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
