import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { GetTransferAccess } from "../../../data/private-transfer";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
import { SkillPluginIcon } from "../../../ui/SkillPluginIcon";
import { AppText } from "../../../ui/Typography";
import type { ComposerMention } from "./composer-mentions";
import type { SuggestionState } from "./composer-suggestions";

type PopupProps = {
  readonly getTransferAccess?: GetTransferAccess;
  readonly onSelect: (mention: ComposerMention) => void;
  readonly state: SuggestionState;
};

export function ComposerSuggestionsPopup(props: PopupProps) {
  if (props.state.status === "closed") {
    return null;
  }
  const items =
    props.state.status === "ready" || props.state.status === "loading" ? props.state.items : [];
  if (props.state.status === "loading" && items.length === 0) {
    return null;
  }
  const message = props.state.status === "error" ? "Could not load suggestions" : "No matches";
  return (
    <View accessibilityLabel="Composer suggestions" style={styles.popup}>
      <View style={styles.header}>
        <AppText style={styles.heading}>
          {props.state.query.indicator === "/" ? "Skills" : "Context"}
        </AppText>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        style={styles.list}
        testID="composer-suggestions-scroll"
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
  readonly getTransferAccess?: GetTransferAccess;
  readonly mention: ComposerMention;
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
          accessibilityLabel={`Insert ${props.mention.label}`}
          accessibilityRole="button"
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
            accessibilityLabel={`About ${props.mention.label}`}
            accessibilityRole="button"
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
  choice: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  group: {
    ...typeScale.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  heading: {
    ...typeScale.body,
    color: colors.text,
  },
  info: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  list: { maxHeight: controlSize.regular * 6 },
  message: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
  },
  popup: {
    overflow: "hidden",
    width: "100%",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
  },
});
