import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";
import { View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { AppText as Text } from "../../../ui/Typography";
import type { AnswerDraft, QuestionInteraction } from "./questionContract";
import { loadQuestionSession, type QuestionSession, type QuestionState } from "./questionSession";
import { QuestionForm } from "./QuestionForm";
import { QuestionHeading } from "./QuestionSummary";
import { styles } from "./QuestionCard.styles";

/** Explicit transport evidence and submission capability for one form. */
export type QuestionCardProps = {
  readonly canSend: boolean;
  readonly delivered: boolean;
  readonly deliveredReply?: string | null;
  readonly failed: boolean;
  readonly hideWhenSubmitted?: boolean;
  readonly interaction: QuestionInteraction;
  readonly onSkip?: () => Promise<void>;
  readonly send: (drafts: readonly AnswerDraft[], retry: boolean) => Promise<void>;
  readonly statusText: string;
};

/** Restores a model-owned draft before enabling the docked question editor. */
export function QuestionCard(props: QuestionCardProps): React.JSX.Element {
  const resource = useAsyncResource(`question:${props.interaction.key}`, 0, async () =>
    loadQuestionSession(props.interaction),
  );
  if (resource.value === null) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>
          {resource.error === null ? "Загружаю вопрос…" : "Не удалось восстановить ответ"}
        </Text>
      </View>
    );
  }
  return <QuestionEditor {...props} session={resource.value} />;
}

function QuestionEditor(
  props: QuestionCardProps & { session: QuestionSession },
): React.JSX.Element | null {
  const { interaction, session } = props;
  const state = useSelector(() => ({
    delivery: session.state$.delivery.get(),
    drafts: session.state$.drafts.get(),
    page: session.state$.page.get(),
    skipState: session.state$.skipState.get(),
    storageError: session.state$.storageError.get(),
  }));
  useEffect(() => {
    if (props.delivered) {
      session.confirmDelivery(props.deliveredReply ?? null);
    } else if (props.failed && session.state$.peek().delivery.status !== "delivered") {
      session.state$.delivery.set({ status: "failed" });
    }
  }, [props.delivered, props.deliveredReply, props.failed, session]);
  const skip = useEvent(() => {
    if (props.onSkip !== undefined) {
      void session.skip(props.onSkip).catch(() => {
        session.state$.skipState.set("failed");
      });
    }
  });
  const skipAction = props.onSkip === undefined ? undefined : skip;
  const delivered = props.delivered || state.delivery.status === "delivered";
  if (state.skipState === "skipped" || delivered) {
    return null;
  }
  if (props.hideWhenSubmitted === true && state.delivery.status === "queued") {
    return null;
  }
  return (
    <View style={styles.card} testID="question-card">
      <QuestionHeading
        count={interaction.questions.length}
        onSkip={skipAction}
        page={state.page}
        skipDisabled={skipDisabled(props.canSend, state)}
        status={
          state.delivery.status === "queued" ? "Ожидает подтверждения доставки" : props.statusText
        }
      />
      <QuestionForm
        canSend={props.canSend}
        delivered={delivered}
        interaction={interaction}
        onSkip={skipAction}
        send={props.send}
        session={session}
        state={state}
      />
    </View>
  );
}

function skipDisabled(canSend: boolean, state: QuestionState): boolean {
  return !canSend || state.skipState === "skipping" || state.delivery.status === "sending";
}
