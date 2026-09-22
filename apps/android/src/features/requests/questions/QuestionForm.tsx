import { Ionicons } from "@expo/vector-icons";
import { occurrenceKey } from "../../../rendering/listKey";
import type { QuestionFormProps } from "./questionFormTypes";
import { TextInput, View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../../ui/typography-policy";
import { productFontStyle, AppText as Text } from "../../../ui/Typography";
import type { AnswerDraft, Question } from "./questionContract";
import type { QuestionState } from "./questionSession";
import { QuestionOption } from "./QuestionOption";
import { QuestionActions } from "./QuestionActions";
import { styles } from "./QuestionCard.styles";

/** Displays a single page over the retained multi-question draft. */
export function QuestionForm(props: QuestionFormProps): React.JSX.Element | null {
  const { interaction, session, state } = props;
  const question = interaction.questions[state.page];
  const draft = state.drafts[state.page];
  const changeText = useEvent((custom: string) => {
    session.setDraft(state.page, { custom, selected: null });
  });
  const select = useEvent((selected: number | null) => {
    session.setDraft(state.page, { custom: draft?.custom ?? "", selected });
  });
  const focusCustom = useEvent(() => {
    select(null);
  });
  if (question === undefined || draft === undefined) {
    return null;
  }
  const locked =
    props.delivered || state.delivery.status !== "editing" || state.skipState === "skipping";
  return (
    <>
      <Text style={styles.question}>{question.title}</Text>
      <QuestionChoices draft={draft} locked={locked} question={question} select={select} />
      <View style={styles.footer}>
        <QuestionCustomAnswer
          changeText={changeText}
          draft={draft}
          focusCustom={focusCustom}
          locked={locked}
          question={question}
        />
        <QuestionActions {...props} />
      </View>
      <QuestionErrors state={state} />
    </>
  );
}
function QuestionCustomAnswer({
  changeText,
  draft,
  focusCustom,
  locked,
  question,
}: {
  changeText: (value: string) => void;
  draft: AnswerDraft;
  focusCustom: () => void;
  locked: boolean;
  question: Question;
}): React.JSX.Element {
  return (
    <View style={styles.custom}>
      <View style={styles.number}>
        <Ionicons color={colors.textMuted} name="pencil-outline" size={iconSize.inline} />
      </View>
      <TextInput
        accessibilityLabel={question.title}
        editable={!locked}
        maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
        multiline={!question.secret}
        onChangeText={changeText}
        onFocus={focusCustom}
        placeholder="Свой ответ"
        placeholderTextColor={colors.textDim}
        secureTextEntry={question.secret}
        style={[styles.input, productFontStyle(styles.input)]}
        value={draft.custom}
      />
    </View>
  );
}

function QuestionChoices({
  draft,
  locked,
  question,
  select,
}: {
  draft: AnswerDraft;
  locked: boolean;
  question: Question;
  select: (selected: number | null) => void;
}): React.JSX.Element {
  const occurrences = new Map<string, number>();
  return (
    <View accessibilityRole="radiogroup" style={styles.choices}>
      {question.options.map((option, index) => (
        <QuestionOption
          description={option.description}
          disabled={locked}
          index={index}
          key={occurrenceKey(occurrences, option.label)}
          label={option.label}
          onSelect={() => {
            select(index);
          }}
          selected={draft.selected === index}
        />
      ))}
    </View>
  );
}
function QuestionErrors({ state }: { state: QuestionState }): React.JSX.Element {
  return (
    <>
      {state.storageError && (
        <Text style={styles.error}>Не удалось сохранить черновик на устройстве</Text>
      )}
      {state.skipState === "failed" && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Не удалось пропустить вопрос. Попробуй ещё раз.
        </Text>
      )}
      {state.delivery.status === "failed" && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Не удалось отправить. Проверь ответ и повтори.
        </Text>
      )}
    </>
  );
}
