import { Pressable, View } from "react-native";
import { controlHitSlop } from "../../../theme";
import { useEvent } from "../../../react/useEvent";
import { AppText as Text } from "../../../ui/Typography";
import { answerText } from "./questionContract";
import type { QuestionFormProps } from "./questionFormTypes";
import type { QuestionDelivery } from "./questionSession";
import { styles } from "./QuestionCard.styles";

/** Changes pages without submitting; only the final action sends the complete form. */
export function QuestionActions(props: QuestionFormProps): React.JSX.Element {
  const { interaction, session, state } = props;
  const previous = useEvent(() => {
    session.setPage(Math.max(0, state.page - 1));
  });
  const next = useEvent(() => {
    session.setPage(Math.min(interaction.questions.length - 1, state.page + 1));
  });
  return (
    <View style={styles.actions}>
      {state.page > 0 && (
        <Pressable
          accessibilityRole="button"
          hitSlop={controlHitSlop.regular}
          onPress={previous}
          style={styles.action}
        >
          <Text style={styles.optionText}>Назад</Text>
        </Pressable>
      )}
      {props.onSkip !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              !props.canSend ||
              state.skipState === "skipping" ||
              state.delivery.status === "sending",
          }}
          disabled={
            !props.canSend || state.skipState === "skipping" || state.delivery.status === "sending"
          }
          hitSlop={controlHitSlop.regular}
          onPress={props.onSkip}
          style={[styles.action, styles.secondary]}
        >
          <Text style={styles.optionText}>Пропустить</Text>
        </Pressable>
      )}
      {state.page < interaction.questions.length - 1 ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={controlHitSlop.regular}
          onPress={next}
          style={styles.action}
        >
          <Text style={styles.optionText}>Далее</Text>
        </Pressable>
      ) : (
        <QuestionSubmit {...props} />
      )}
    </View>
  );
}
function QuestionSubmit(props: QuestionFormProps): React.JSX.Element {
  const submit = useEvent(() => {
    void props.session.submit(props.send).catch(() => {
      props.session.state$.delivery.set({ status: "failed" });
    });
  });
  const disabled = !maySubmit(props);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.regular}
      onPress={submit}
      style={[styles.action, styles.primary, disabled && styles.disabled]}
    >
      <Text style={styles.primaryText}>
        {submitLabel(props.state.delivery, props.interaction.questions.length)}
      </Text>
    </Pressable>
  );
}
function maySubmit({ canSend, interaction, state }: QuestionFormProps): boolean {
  if (
    !canSend ||
    state.skipState === "skipping" ||
    (state.delivery.status !== "editing" && state.delivery.status !== "failed")
  ) {
    return false;
  }
  for (const [index, question] of interaction.questions.entries()) {
    if (answerText(question, state.drafts[index] ?? { custom: "", selected: null }) === "") {
      return false;
    }
  }
  return true;
}
function submitLabel(delivery: QuestionDelivery, count: number): string {
  switch (delivery.status) {
    case "sending":
      return "Отправляю…";
    case "queued":
      return "Ответ в очереди";
    case "failed":
      return "Повторить";
    case "editing":
    case "delivered":
      return count > 1 ? "Отправить ответы" : "Ответить";
    default:
      throw new Error("Unsupported question delivery state");
  }
}
