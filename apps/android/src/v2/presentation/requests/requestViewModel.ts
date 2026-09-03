import type { V2ApprovalDecision } from "@codewide/sync-client/v2";

export type ApprovalDecision = V2ApprovalDecision;

export interface ApprovalRequestViewModel {
  approvalKind: "commandApproval" | "fileChangeApproval" | "permissionApproval";
  availableDecisions: readonly ApprovalDecision[];
  detail: string | null;
  id: string;
  kind: "approval";
  reason: string | null;
  summary: string;
}

interface UserInputOptionViewModel {
  description: string;
  label: string;
}

interface UserInputQuestionViewModel {
  header: string;
  id: string;
  isOther: boolean;
  isSecret: boolean;
  options: readonly UserInputOptionViewModel[] | null;
  question: string;
}

export interface UserInputRequestViewModel {
  id: string;
  kind: "userInput";
  questions: readonly UserInputQuestionViewModel[];
}

interface ElicitationFieldViewModel {
  defaultValue:
    | { kind: "unset" }
    | {
        kind: "value";
        value: boolean | number | readonly string[] | string | null;
      };
  description: string | null;
  id: string;
  label: string;
  options: readonly { label: string; value: string }[] | null;
  required: boolean;
  type: "array" | "boolean" | "integer" | "number" | "secret" | "select" | "text";
}

export interface ElicitationRequestViewModel {
  fields: readonly ElicitationFieldViewModel[];
  id: string;
  kind: "elicitation";
  message: string;
  mode: "form" | "openaiForm" | "url";
  serverName: string;
  title: string;
  url: string | null;
}

export type PendingRequestViewModel =
  | ApprovalRequestViewModel
  | ElicitationRequestViewModel
  | UserInputRequestViewModel;

export interface UserInputAnswer {
  answers: string[];
  questionId: string;
}

export interface ElicitationValue {
  fieldId: string;
  value: readonly string[] | string | null;
}

export type PendingRequestViewResolution =
  | { decision: ApprovalDecision; kind: "approval" }
  | { answers: UserInputAnswer[]; kind: "userInput" }
  | {
      action: "accept" | "cancel" | "decline";
      kind: "elicitation";
      values: ElicitationValue[];
    };
