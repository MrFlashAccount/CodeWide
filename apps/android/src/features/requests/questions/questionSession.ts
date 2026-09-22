import { observable, type Observable } from "@legendapp/state";
import { readQuestionDraft, writeQuestionDraft } from "../../../data/questionDraftStorage";
import { unknownRecord } from "../../../data/unknownRecord";
import {
  answerText,
  type AnswerDraft,
  type QuestionInteraction,
  type Question,
} from "./questionContract";

/** Form submission phase; accepted into transport is not an agent receipt. */
export type QuestionDelivery =
  | { readonly status: "editing" }
  | { readonly status: "sending" }
  | { readonly status: "queued" }
  | { readonly reply: string | null; readonly status: "delivered" }
  | { readonly status: "failed" };
/** Retained local editor state. */
export type QuestionState = {
  readonly delivery: QuestionDelivery;
  readonly drafts: readonly AnswerDraft[];
  readonly page: number;
  readonly skipState: "ready" | "skipping" | "skipped" | "failed";
  readonly storageError: boolean;
};

/** Owns question drafts across virtualized mounts; transport owns delivery evidence. */
export async function loadQuestionSession(
  interaction: QuestionInteraction,
): Promise<QuestionSession> {
  const stored = await readQuestionDraft(interaction.key);
  const row = stored === null ? null : unknownRecord(JSON.parse(stored));
  const saved = Array.isArray(row?.drafts) ? row.drafts : [];
  const drafts = interaction.questions.map((question, index) =>
    restoreDraft(question, saved[index]),
  );
  const state$ = observable<QuestionState>({
    delivery: restoredDelivery(
      row,
      interaction.questions.some((question) => question.secret),
    ),
    drafts,
    page: 0,
    skipState: "ready",
    storageError: false,
  });
  let writes = Promise.resolve();
  const persist = async (): Promise<void> => {
    const state = state$.peek();
    const serialized = JSON.stringify({
      delivered: state.delivery.status === "delivered",
      deliveredReply: state.delivery.status === "delivered" ? state.delivery.reply : null,
      drafts: state.drafts.map((draft, index) =>
        interaction.questions[index]?.secret === true ? { custom: "", selected: null } : draft,
      ),
      submitted: state.delivery.status !== "editing" && state.delivery.status !== "failed",
    });
    const write = writes
      .catch(() => undefined)
      .then(async () => writeQuestionDraft(interaction.key, serialized));
    writes = write;
    return write;
  };
  const save = () => {
    void persist().then(
      () => state$.storageError.set(false),
      () => state$.storageError.set(true),
    );
  };
  return {
    confirmDelivery(reply: string | null): void {
      if (state$.peek().delivery.status === "delivered") {
        return;
      }
      state$.delivery.set({
        reply: interaction.questions.some((question) => question.secret) ? null : reply,
        status: "delivered",
      });
      save();
    },
    setDraft(index: number, value: AnswerDraft): void {
      if (state$.peek().delivery.status !== "editing") {
        return;
      }
      state$.drafts.set(
        state$.peek().drafts.map((draft, draftIndex) => (draftIndex === index ? value : draft)),
      );
      save();
    },
    setPage(page: number): void {
      state$.page.set(page);
    },
    async skip(action: () => Promise<void>): Promise<void> {
      const state = state$.peek();
      if (
        state.skipState === "skipping" ||
        state.skipState === "skipped" ||
        state.delivery.status === "sending"
      ) {
        return;
      }
      state$.skipState.set("skipping");
      try {
        await action();
        state$.skipState.set("skipped");
      } catch {
        state$.skipState.set("failed");
      }
    },
    state$,
    async submit(
      send: (drafts: readonly AnswerDraft[], retry: boolean) => Promise<void>,
    ): Promise<void> {
      const current = state$.peek();
      if (
        current.skipState === "skipping" ||
        current.skipState === "skipped" ||
        (current.delivery.status !== "editing" && current.delivery.status !== "failed")
      ) {
        return;
      }
      if (
        interaction.questions.some(
          (question, index) =>
            answerText(question, current.drafts[index] ?? { custom: "", selected: null }) === "",
        )
      ) {
        return;
      }
      const retry = current.delivery.status === "failed";
      const submittedDrafts = current.drafts;
      state$.delivery.set({ status: "sending" });
      try {
        await persist();
        await send(submittedDrafts, retry);
        if (state$.peek().delivery.status !== "delivered") {
          state$.delivery.set({ status: "queued" });
        }
        save();
      } catch {
        state$.delivery.set({ status: "failed" });
        save();
      }
    },
  };
}
/** Draft operations do not expose any transport or composer state. */
export type QuestionSession = {
  confirmDelivery: (reply: string | null) => void;
  setDraft: (index: number, value: AnswerDraft) => void;
  setPage: (page: number) => void;
  skip: (action: () => Promise<void>) => Promise<void>;
  state$: Observable<QuestionState>;
  submit: (
    send: (drafts: readonly AnswerDraft[], retry: boolean) => Promise<void>,
  ) => Promise<void>;
};
function restoreDraft(question: Question, value: unknown): AnswerDraft {
  if (question.secret) {
    return { custom: "", selected: null };
  }
  const row = unknownRecord(value);
  return {
    custom: typeof row?.custom === "string" ? row.custom : "",
    selected: restoreSelection(question, row?.selected),
  };
}
function restoreSelection(question: Question, value: unknown): number | null {
  if (value === undefined) {
    return question.options.length === 0 ? null : 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  return question.options[value] === undefined ? null : value;
}

function restoredDelivery(
  row: Record<string, unknown> | null,
  hasSecret: boolean,
): QuestionDelivery {
  if (row?.delivered === true) {
    return {
      reply: typeof row.deliveredReply === "string" ? row.deliveredReply : null,
      status: "delivered",
    };
  }
  return row?.submitted === true && !hasSecret ? { status: "failed" } : { status: "editing" };
}
