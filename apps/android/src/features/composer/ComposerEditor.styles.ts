import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";
import { COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT } from "./composerLayout";

export const styles = StyleSheet.create({
  composerInput: {
    color: colors.text,
    maxHeight: COMPOSER_MAX_HEIGHT,
    minHeight: COMPOSER_MIN_HEIGHT,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.xxs,
    paddingVertical: spacing.inputInset,
    ...typeScale.composerInput,
  },
});
