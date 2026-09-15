import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { GetTransferAccess } from "../../../data/private-transfer";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { SkillPluginIcon } from "../../../ui/SkillPluginIcon";
import { AppText } from "../../../ui/Typography";
import type { ComposerMention } from "./composer-mentions";
import type { SuggestionState } from "./composer-suggestions";

type PopupProps = {
  readonly state: SuggestionState;
  readonly getTransferAccess?: GetTransferAccess;
  readonly onSelect: (mention: ComposerMention) => void;
};

export function ComposerSuggestionsPopup(props: PopupProps) {
  if (props.state.status === "closed") return null;
  const items =
    props.state.status === "ready" || props.state.status === "loading" ? props.state.items : [];
  if (props.state.status === "loading" && items.length === 0) return null;
  const message = props.state.status === "error" ? "Could not load suggestions" : "No matches";
  return (
    <View style={styles.popup} accessibilityLabel="Composer suggestions">
      <View style={styles.header}>
        <AppText style={styles.heading}>
          {props.state.query.indicator === "/" ? "Skills" : "Context"}
        </AppText>
      </View>
      <ScrollView
        testID="composer-suggestions-scroll"
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        style={styles.list}
      >
        {items.length === 0 ? (
          <AppText style={styles.message}>{message}</AppText>
        ) : (
          items.map((item, index) => (
            <View key={item.id}>
              {item.kind === "thread" && item.group !== items[index - 1]?.group ? (
                <AppText style={styles.group}>{item.group}</AppText>
              ) : null}
              <SuggestionRow
                mention={item}
                {...(props.getTransferAccess === undefined
                  ? {}
                  : { getTransferAccess: props.getTransferAccess })}
                onSelect={props.onSelect}
              />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

type RowProps = {
  readonly mention: ComposerMention;
  readonly getTransferAccess?: GetTransferAccess;
  readonly onSelect: (mention: ComposerMention) => void;
};

function SuggestionRow(props: RowProps) {
  const [showInfo, setShowInfo] = useState(false);
  function select() {
    props.onSelect(props.mention);
  }
  function toggleInfo() {
    setShowInfo(!showInfo);
  }
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Insert ${props.mention.label}`}
          onPress={select}
          style={styles.choice}
        >
          {props.mention.kind === "skill" ? (
            <SkillPluginIcon
              plugin={props.mention.plugin}
              {...(props.getTransferAccess === undefined
                ? {}
                : { getTransferAccess: props.getTransferAccess })}
            />
          ) : null}
          <AppText numberOfLines={1} style={styles.name}>
            {props.mention.label}
          </AppText>
        </Pressable>
        {props.mention.description !== "" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`About ${props.mention.label}`}
            accessibilityState={{ expanded: showInfo }}
            onPress={toggleInfo}
            style={styles.info}
          >
            <AppText style={styles.heading}>ⓘ</AppText>
          </Pressable>
        ) : null}
      </View>
      {showInfo ? <AppText style={styles.message}>{props.mention.description}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  popup: {
    width: "100%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heading: {
    ...typeScale.body,
    color: colors.text,
  },
  list: { maxHeight: controlSize.regular * 6 },
  group: {
    ...typeScale.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  choice: {
    flex: 1,
    minWidth: 0,
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
  },
  info: {
    width: controlSize.regular,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
