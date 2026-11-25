import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../../theme";
import { useEvent } from "../../../react/useEvent";
import { AppText as Text } from "../../../ui/Typography";
import { occurrenceKey } from "../../../rendering/listKey";
import type { Question } from "./questionContract";
import { styles } from "./QuestionCard.styles";

type Option = Question["options"][number];
type RowActions = {
  readonly disabled: boolean;
  readonly onChoose: (text: string) => void;
  readonly onEdit: ((text: string) => void) | undefined;
};
function OptionRow({ disabled, onChoose, onEdit, option }: RowActions & { option: Option }) {
  const choose = useEvent(() => {
    onChoose(option.label);
  });
  const edit = useEvent(() => onEdit?.(option.label));
  return (
    <Pressable
      accessibilityHint={
        onEdit !== undefined
          ? "Нажми, чтобы ответить. Удерживай, чтобы изменить в поле сообщения."
          : undefined
      }
      accessibilityLabel={option.label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onLongPress={edit}
      onPress={choose}
      style={styles.answerRow}
    >
      <View style={styles.optionBody}>
        <Text style={styles.optionText}>{option.label}</Text>
        {option.description !== "" && <Text style={styles.description}>{option.description}</Text>}
      </View>
      <Ionicons color={colors.textMuted} name="return-down-back-outline" size={iconSize.inline} />
    </Pressable>
  );
}

/** Transcript question with wrapping instant answers and a single shared composer. */
export function TimelineQuestionCard({
  disabled,
  error,
  onBack,
  onChoose,
  onEdit,
  onRetry,
  onSkip,
  page,
  question,
  total,
}: RowActions & {
  error: string | null;
  onBack: () => void;
  onRetry: (() => void) | null;
  onSkip: () => void;
  page: number;
  question: Question;
  total: number;
}): React.JSX.Element {
  const keys = new Map<string, number>();
  return (
    <View style={styles.timelineCard} testID="question-card">
      <QuestionHeader
        disabled={disabled}
        onBack={onBack}
        onSkip={onSkip}
        page={page}
        total={total}
      />
      <Text style={styles.question}>{question.title}</Text>
      {question.options.map((option) => (
        <OptionRow
          disabled={disabled}
          key={occurrenceKey(keys, option.label)}
          onChoose={onChoose}
          onEdit={onEdit}
          option={option}
        />
      ))}
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
      {onRetry !== null && (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.action}>
          <Text style={styles.optionText}>Повторить</Text>
        </Pressable>
      )}
    </View>
  );
}

function QuestionHeader({
  disabled,
  onBack,
  onSkip,
  page,
  total,
}: {
  disabled: boolean;
  onBack: () => void;
  onSkip: () => void;
  page: number;
  total: number;
}) {
  return (
    <View style={styles.header}>
      <Ionicons
        color={colors.textMuted}
        name="chatbubble-ellipses-outline"
        size={iconSize.inline}
      />
      <Text style={styles.label}>
        {total > 1 ? `Вопрос ${String(page + 1)} из ${String(total)}` : "Вопрос агента"}
      </Text>
      {page > 0 && (
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onBack}
          style={styles.action}
        >
          <Text style={styles.muted}>Назад</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityLabel="Пропустить вопрос"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onSkip}
        style={styles.action}
      >
        <Text style={styles.muted}>Пропустить</Text>
      </Pressable>
    </View>
  );
}
