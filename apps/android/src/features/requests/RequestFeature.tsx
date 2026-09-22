import { RpcQuestionCard } from "./QuestionFeature";
import { RequestFields } from "./RequestFields";
import { RequestResponseActions } from "./RequestResponseActions";
/** V1 RequestFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { basename } from "../../rendering/changed-file-path";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { mcpElicitationFields, parseElicitationValue } from "./elicitationForm";
import { isSafeHttpUrl } from "../../rendering/http-link";
import { styles } from "./RequestFeature.styles";

function ApprovalForm({
  embedded = false,
  onRespond,
  request,
  requestCount,
}: {
  embedded?: boolean;
  onRespond?: (request: PendingServerRequest, result: unknown) => Promise<void>;
  request: PendingServerRequest;
  requestCount: number;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const respond = async (result: unknown) => {
    if (onRespond === undefined) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRespond(request, result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not resolve request");
    }
    setSubmitting(false);
  };
  const method = request.method;
  const params = request.params;
  const waiting = submitting || request.state === "resolving";
  const questions =
    method === "item/tool/requestUserInput" && Array.isArray(params.questions)
      ? params.questions.filter(
          (value): value is Record<string, unknown> =>
            value !== null && typeof value === "object" && !Array.isArray(value),
        )
      : [];
  const command = typeof params.command === "string" ? params.command : null;
  const cwd = typeof params.cwd === "string" ? params.cwd : null;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const elicitationMessage =
    method === "mcpServer/elicitation/request" && typeof params.message === "string"
      ? params.message
      : null;
  const elicitationFields =
    method === "mcpServer/elicitation/request" ? mcpElicitationFields(params) : [];
  const elicitationMode =
    method === "mcpServer/elicitation/request" && typeof params.mode === "string"
      ? params.mode
      : null;
  const elicitationUrl =
    elicitationMode === "url" && typeof params.url === "string" && isSafeHttpUrl(params.url)
      ? params.url
      : null;
  const submitElicitation = () => {
    try {
      const content = Object.fromEntries(
        elicitationFields.map((field) => {
          const raw = answers[field.id] ?? field.defaultValue;
          if (field.required && raw.trim() === "") {
            throw new Error(`${field.label} is required`);
          }
          return [field.id, parseElicitationValue(field.type, raw)];
        }),
      );
      respond({ _meta: null, action: "accept", content }).catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not resolve request");
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid form value");
    }
  };
  return (
    <View style={[styles.approvalCard, embedded && styles.approvalInline]}>
      <View style={styles.approvalTitleRow}>
        <Ionicons color={colors.amber} name="shield-checkmark-outline" size={iconSize.action} />
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.approvalTitle}>
          {approvalTitle(method)}
        </Text>
        {requestCount > 1 && <Text style={styles.approvalQueueCount}>1/{requestCount}</Text>}
        {waiting && <Text style={styles.approvalPending}>RESOLVING…</Text>}
      </View>
      {reason !== null && (
        <Text numberOfLines={1} style={styles.approvalReason}>
          {reason}
        </Text>
      )}
      {elicitationMessage !== null && (
        <Text numberOfLines={2} style={styles.approvalReason}>
          {elicitationMessage}
        </Text>
      )}
      {command !== null && (
        <Text numberOfLines={2} selectable style={styles.approvalCommand}>
          {command}
        </Text>
      )}
      {cwd !== null && (
        <Text numberOfLines={1} selectable style={styles.approvalCwd}>
          ⌁ {basename(cwd)}
        </Text>
      )}
      <RequestFields
        answers={answers}
        elicitationFields={elicitationFields}
        questions={questions}
        setAnswers={setAnswers}
      />
      {elicitationUrl !== null && (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(elicitationUrl)}>
          <Text numberOfLines={2} style={styles.rawLink}>
            Open secure form · {elicitationUrl}
          </Text>
        </Pressable>
      )}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
      <RequestResponseActions
        answers={answers}
        elicitationFields={elicitationFields}
        elicitationMode={elicitationMode}
        elicitationUrl={elicitationUrl}
        method={method}
        params={params}
        questions={questions}
        respond={respond}
        submitElicitation={submitElicitation}
        waiting={waiting}
      />
    </View>
  );
}

function approvalTitle(method: string): string {
  if (method === "item/commandExecution/requestApproval") {
    return "Command approval";
  }
  if (method === "item/fileChange/requestApproval") {
    return "File change approval";
  }
  if (method === "item/tool/requestUserInput") {
    return "Codex needs input";
  }
  if (method === "item/permissions/requestApproval") {
    return "Additional permissions";
  }
  return "External tool request";
}

/** Chooses the question form independently of security approval presentation. */
export function ApprovalPrompt(props: Parameters<typeof ApprovalForm>[0]): React.JSX.Element {
  return props.request.method === "item/tool/requestUserInput" ? (
    <RpcQuestionCard onRespond={props.onRespond} request={props.request} />
  ) : (
    <ApprovalForm {...props} />
  );
}
