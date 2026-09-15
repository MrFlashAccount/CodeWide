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
  readonly subtitle?: string;
  readonly pinned?: boolean;
}

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly onChange: (id: string) => void;
}

export function FilterSelect(props: SelectProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  const selected = props.options.find((option) => option.id === props.value);
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Search ${props.label.toLowerCase()}`}
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.select}
      >
        <Text numberOfLines={1} style={styles.selected}>
          {selected?.label ?? "Unavailable"}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
          color={colors.textMuted}
        />
      </Pressable>
      {expanded && (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.options}>
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
                onPress={select}
                selected={props.value === option.id}
                position={listRowPosition(index, props.options.length)}
                multiline
                accessibilityLabel={
                  option.pinned === true ? `${option.label}, pinned project` : option.label
                }
                {...(option.pinned === true
                  ? {
                      trailingIcon: {
                        name: "pin-outline",
                        size: iconSize.inline,
                        color: colors.textMuted,
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
