import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, TextInput, View } from "react-native";

import type { SearchValues } from "../../../data/forgePullRequestSearch";
import { useEvent } from "../../../react/useEvent";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import {
  addPullRequestTerms,
  commitPullRequestTermText,
  pullRequestTermText,
  removePullRequestTerm,
  updatePullRequestTermText,
  type PullRequestTermField as TermField,
} from "../pullRequestListModel";
import { filterStyles as styles } from "./filter.styles";

/** One-tap value offered under a field, such as a linked account's login. */
export type PullRequestTermSuggestion = {
  readonly label: string;
  readonly value: string;
};

/**
 * Token editor of one free-text query field. Entered values render as
 * removable chips; Enter or a comma adds a token, and every keystroke lands in
 * the tray draft, so Apply never depends on the field losing focus.
 */
export function PullRequestTermField({
  field,
  hint,
  label,
  placeholder,
  suggestions,
  values,
}: {
  readonly field: TermField;
  readonly hint: string;
  readonly label: string;
  readonly placeholder: string;
  /** One-tap values; already included ones are not offered again. */
  readonly suggestions: readonly PullRequestTermSuggestion[];
  readonly values: SearchValues<string>;
}): React.JSX.Element {
  const included = new Set(values.include);
  const offered = suggestions.filter((suggestion) => !included.has(suggestion.value));
  return (
    <View style={styles.inputGroup} testID={`pull-request-term-${field}`}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Text style={styles.inputHint}>{hint}</Text>
      <View style={styles.tokenBox}>
        {values.include.map((value) => (
          <TermToken field={field} key={`include:${value}`} label={label} value={value} />
        ))}
        {values.exclude.map((value) => (
          <TermToken excluded field={field} key={`exclude:${value}`} label={label} value={value} />
        ))}
        <TermInput field={field} label={label} placeholder={placeholder} />
      </View>
      {offered.length === 0 ? null : (
        <View style={styles.suggestions}>
          {offered.map((suggestion) => (
            <TermSuggestion
              field={field}
              key={suggestion.value}
              label={label}
              suggestion={suggestion}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TermInput({
  field,
  label,
  placeholder,
}: {
  readonly field: TermField;
  readonly label: string;
  readonly placeholder: string;
}): React.JSX.Element {
  const text = useSelector(() => pullRequestTermText(field));
  const change = useEvent((next: string) => {
    updatePullRequestTermText(field, next);
  });
  const submit = useEvent(() => {
    commitPullRequestTermText(field);
  });
  return (
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={change}
      onSubmitEditing={submit}
      placeholder={placeholder}
      placeholderTextColor={colors.textDim}
      returnKeyType="done"
      style={styles.tokenInput}
      submitBehavior="submit"
      value={text}
    />
  );
}

function TermToken({
  excluded = false,
  field,
  label,
  value,
}: {
  readonly excluded?: boolean;
  readonly field: TermField;
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  const remove = useEvent(() => {
    removePullRequestTerm(field, value);
  });
  const text = excluded ? `not ${value}` : value;
  return (
    <Pressable
      accessibilityLabel={`Remove ${label} ${text}`}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={remove}
      style={styles.token}
    >
      <Text numberOfLines={1} style={styles.tokenText}>
        {text}
      </Text>
      <Ionicons color={colors.textMuted} name="close" size={iconSize.indicator} />
    </Pressable>
  );
}

function TermSuggestion({
  field,
  label,
  suggestion,
}: {
  readonly field: TermField;
  readonly label: string;
  readonly suggestion: PullRequestTermSuggestion;
}): React.JSX.Element {
  const add = useEvent(() => {
    addPullRequestTerms(field, [suggestion.value]);
  });
  return (
    <Pressable
      accessibilityLabel={`Add ${label} ${suggestion.label}`}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={add}
      style={styles.suggestion}
    >
      <Ionicons color={colors.textMuted} name="add" size={iconSize.indicator} />
      <Text numberOfLines={1} style={styles.suggestionText}>
        {suggestion.label}
      </Text>
    </Pressable>
  );
}
