/** V1 RequestFeature owner, extracted without changing interaction or resource lifetime. */
import { Pressable, View } from "react-native";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { AppText as Text } from "../../ui/Typography";
import { mcpElicitationFields } from "./elicitationForm";
import { styles } from "./RequestFeature.styles";

type RequestResponseActionsProps = {
  method: string;
  params: PendingServerRequest["params"];
  waiting: boolean;
  questions: Record<string, unknown>[];
  answers: Record<string, string>;
  elicitationFields: ReturnType<typeof mcpElicitationFields>;
  elicitationUrl: string | null;
  elicitationMode: string | null;
  respond(result: unknown): Promise<void>;
  submitElicitation(): void;
};

export function RequestResponseActions({
  method,
  params,
  waiting,
  questions,
  answers,
  elicitationFields,
  elicitationUrl,
  elicitationMode,
  respond,
  submitElicitation,
}: RequestResponseActionsProps) {
  return (
    <View style={styles.approvalActions}>
      {method === "item/tool/requestUserInput" ? (
        <Pressable
          accessibilityRole="button"
          disabled={waiting}
          hitSlop={4}
          onPress={() =>
            void respond({
              answers: Object.fromEntries(
                questions.map((question) => {
                  const id = typeof question.id === "string" ? question.id : "question";
                  return [id, { answers: [answers[id] ?? ""] }];
                }),
              ),
            })
          }
          style={[styles.primaryButton, styles.approvalButton]}
        >
          <Text style={styles.primaryButtonText}>Submit</Text>
        </Pressable>
      ) : method === "item/permissions/requestApproval" ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ permissions: {}, scope: "turn" })}
            style={[styles.approvalDeclineButton, styles.approvalButton]}
          >
            <Text style={styles.approvalDeclineText}>Decline</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ permissions: params.permissions ?? {}, scope: "turn" })}
            style={[styles.primaryButton, styles.approvalButton]}
          >
            <Text style={styles.primaryButtonText}>Allow turn</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() =>
              void respond({ permissions: params.permissions ?? {}, scope: "session" })
            }
            style={[styles.secondaryButton, styles.approvalButton]}
          >
            <Text style={styles.secondaryButtonText}>For session</Text>
          </Pressable>
        </>
      ) : method === "mcpServer/elicitation/request" ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ action: "decline", content: null, _meta: null })}
            style={[styles.approvalDeclineButton, styles.approvalButton]}
          >
            <Text style={styles.approvalDeclineText}>Decline</Text>
          </Pressable>
          {(elicitationFields.length > 0 || elicitationUrl !== null) && (
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={
                elicitationMode === "url"
                  ? () => void respond({ action: "accept", content: null, _meta: null })
                  : submitElicitation
              }
              style={[styles.primaryButton, styles.approvalButton]}
            >
              <Text style={styles.primaryButtonText}>
                {elicitationMode === "url" ? "Done" : "Submit"}
              </Text>
            </Pressable>
          )}
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ decision: "decline" })}
            style={[styles.approvalDeclineButton, styles.approvalButton]}
          >
            <Text style={styles.approvalDeclineText}>Decline</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ decision: "accept" })}
            style={[styles.primaryButton, styles.approvalButton]}
          >
            <Text style={styles.primaryButtonText}>Accept once</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() => void respond({ decision: "acceptForSession" })}
            style={[styles.secondaryButton, styles.approvalButton]}
          >
            <Text style={styles.secondaryButtonText}>For session</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
