/** V1 RequestFeature owner, extracted without changing interaction or resource lifetime. */
import { Pressable, View } from "react-native";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { useEvent } from "../../react/useEvent";
import { controlHitSlop } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { mcpElicitationFields } from "./elicitationForm";
import { styles } from "./RequestFeature.styles";

type ApprovalActionVariant = "primary" | "quiet" | "secondary";

type ApprovalActionButtonProps = {
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly variant: ApprovalActionVariant;
};

function ApprovalActionButton({
  disabled,
  label,
  onPress,
  variant,
}: ApprovalActionButtonProps): React.JSX.Element {
  const activate = useEvent(onPress);
  const variantStyle =
    variant === "primary"
      ? styles.approvalActionPrimary
      : variant === "secondary"
        ? styles.approvalActionSecondary
        : styles.approvalActionQuiet;
  const textStyle =
    variant === "primary"
      ? styles.approvalActionPrimaryText
      : variant === "secondary"
        ? styles.approvalActionSecondaryText
        : styles.approvalActionQuietText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.regular}
      onPress={activate}
      style={[styles.approvalAction, variantStyle]}
    >
      <Text numberOfLines={1} style={[styles.approvalActionText, textStyle]}>
        {label}
      </Text>
    </Pressable>
  );
}

type RequestResponseActionsProps = {
  answers: Record<string, string>;
  elicitationFields: ReturnType<typeof mcpElicitationFields>;
  elicitationMode: string | null;
  elicitationUrl: string | null;
  method: string;
  params: PendingServerRequest["params"];
  questions: Record<string, unknown>[];
  respond: (result: unknown) => Promise<void>;
  submitElicitation: () => void;
  waiting: boolean;
};

export function RequestResponseActions({
  answers,
  elicitationFields,
  elicitationMode,
  elicitationUrl,
  method,
  params,
  questions,
  respond,
  submitElicitation,
  waiting,
}: RequestResponseActionsProps): React.JSX.Element {
  return (
    <View style={styles.approvalActions}>
      {method === "item/tool/requestUserInput" ? (
        <ApprovalActionButton
          disabled={waiting}
          label="Submit"
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
          variant="primary"
        />
      ) : method === "item/permissions/requestApproval" ? (
        <>
          <ApprovalActionButton
            disabled={waiting}
            label="Decline"
            onPress={() => void respond({ permissions: {}, scope: "turn" })}
            variant="quiet"
          />
          <ApprovalActionButton
            disabled={waiting}
            label="Allow turn"
            onPress={() => void respond({ permissions: params.permissions ?? {}, scope: "turn" })}
            variant="primary"
          />
          <ApprovalActionButton
            disabled={waiting}
            label="For session"
            onPress={() =>
              void respond({ permissions: params.permissions ?? {}, scope: "session" })
            }
            variant="secondary"
          />
        </>
      ) : method === "mcpServer/elicitation/request" ? (
        <>
          <ApprovalActionButton
            disabled={waiting}
            label="Decline"
            onPress={() => void respond({ _meta: null, action: "decline", content: null })}
            variant="quiet"
          />
          {(elicitationFields.length > 0 || elicitationUrl !== null) && (
            <ApprovalActionButton
              disabled={waiting}
              label={elicitationMode === "url" ? "Done" : "Submit"}
              onPress={
                elicitationMode === "url"
                  ? () => void respond({ _meta: null, action: "accept", content: null })
                  : submitElicitation
              }
              variant="primary"
            />
          )}
        </>
      ) : (
        <>
          <ApprovalActionButton
            disabled={waiting}
            label="Decline"
            onPress={() => void respond({ decision: "decline" })}
            variant="quiet"
          />
          <ApprovalActionButton
            disabled={waiting}
            label="Accept once"
            onPress={() => void respond({ decision: "accept" })}
            variant="primary"
          />
          <ApprovalActionButton
            disabled={waiting}
            label="For session"
            onPress={() => void respond({ decision: "acceptForSession" })}
            variant="secondary"
          />
        </>
      )}
    </View>
  );
}
