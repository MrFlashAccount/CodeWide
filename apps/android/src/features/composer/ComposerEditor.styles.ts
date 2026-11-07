import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";
import { COMPOSER_MAX_HEIGHT, COMPOSER_TEXT_INSET } from "./composerLayout";

export const styles = StyleSheet.create({
  composerInput: {
    color: colors.text,
    maxHeight: COMPOSER_MAX_HEIGHT,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.xxs,
    paddingVertical: COMPOSER_TEXT_INSET,
    ...typeScale.composerInput,
  },
});
