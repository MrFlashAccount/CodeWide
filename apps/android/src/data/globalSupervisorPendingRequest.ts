import type { SyncServerRequest } from "@codewide/sync-client";

import type { PendingServerRequest } from "./pending-request-types";
import { projectGlobalSupervisorSafeText } from "./globalSupervisorSafeText";
import { unknownRecord } from "./unknownRecord";

const REQUEST_TEXT_MAX_CHARACTERS = 320;
const REQUEST_QUESTION_MAX_ENTRIES = 8;
const REQUEST_FIELD_MAX_ENTRIES = 16;

type GlobalSupervisorPendingRequestRef = {
  readonly eventId: string;
  readonly requestId: string | number;
};

export type GlobalSupervisorRequestAnswer =
  | {
      readonly decision: "accept" | "acceptForSession" | "decline";
      readonly kind: "approval";
    }
  | {
      readonly decision: "allowSession" | "allowTurn" | "decline";
      readonly kind: "permissions";
    }
  | {
      readonly answers: readonly {
        readonly answer: string;
        readonly questionId: string;
      }[];
      readonly kind: "userInput";
    }
  | {
      readonly action: "accept" | "decline";
      readonly content: Readonly<Record<string, unknown>> | null;
      readonly kind: "elicitation";
    };

export type GlobalSupervisorPendingRequestSummary = GlobalSupervisorPendingRequestRef & {
  readonly response:
    | {
        readonly decisions: readonly ["accept", "acceptForSession", "decline"];
        readonly kind: "approval";
      }
    | {
        readonly decisions: readonly ["allowTurn", "allowSession", "decline"];
        readonly kind: "permissions";
      }
    | {
        readonly kind: "userInput";
        readonly questions: readonly {
          readonly allowsOther: boolean;
          readonly id: string;
          readonly options: readonly string[];
          readonly question: string;
          readonly secret: boolean;
        }[];
      }
    | {
        readonly actions: readonly ("accept" | "decline")[];
        readonly fields: readonly {
          readonly id: string;
          readonly maximum: number | null;
          readonly maxItems: number | null;
          readonly maxLength: number | null;
          readonly minimum: number | null;
          readonly minItems: number | null;
          readonly minLength: number | null;
          readonly options: readonly string[];
          readonly required: boolean;
          readonly type: string;
        }[];
        readonly kind: "elicitation";
      };
  readonly summary: string;
};

type UserInputQuestion = {
  readonly allowsOther: boolean;
  readonly id: string;
  readonly options: readonly string[];
  readonly question: string;
  readonly secret: boolean;
};

type ElicitationField = {
  readonly id: string;
  readonly maximum: number | null;
  readonly maxItems: number | null;
  readonly maxLength: number | null;
  readonly minimum: number | null;
  readonly minItems: number | null;
  readonly minLength: number | null;
  readonly options: readonly unknown[];
  readonly required: boolean;
  readonly type: "array" | "boolean" | "integer" | "number" | "string";
};

function requestIdentity(input: {
  readonly connectionId: string;
  readonly requestId: string | number;
  readonly threadId: string;
}): string {
  return JSON.stringify([
    input.connectionId,
    input.threadId,
    typeof input.requestId,
    JSON.stringify(input.requestId),
  ]);
}

/** Stable identity shared by attention events, active-work snapshots and responses. */
export function globalSupervisorPendingRequestEventId(request: PendingServerRequest): string {
  const threadId = nonEmptyString(request.params.threadId);
  if (threadId === null) {
    throw new Error("The pending request has no valid chat identity");
  }
  return `request:${requestIdentity({
    connectionId: request.connectionId,
    requestId: request.requestId,
    threadId,
  })}`;
}

/** Builds the same event identity before the pending-request database projection. */
export function globalSupervisorServerRequestEventId(
  connectionId: string,
  request: SyncServerRequest,
  threadId: string,
): string {
  return `request:${requestIdentity({ connectionId, requestId: request.id, threadId })}`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function boundedText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const projected = projectGlobalSupervisorSafeText(value, REQUEST_TEXT_MAX_CHARACTERS);
  return projected === "" ? fallback : projected;
}

function userInputOptions(value: unknown): readonly string[] | null {
  if (value !== null && value !== undefined && !Array.isArray(value)) {
    return null;
  }
  const options: string[] = [];
  for (const candidate of Array.isArray(value) ? value : []) {
    const option = unknownRecord(candidate);
    const label = option === null ? null : nonEmptyString(option.label);
    if (label === null) {
      return null;
    }
    options.push(label);
  }
  return options;
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function userInputQuestion(value: unknown): UserInputQuestion | null {
  const row = unknownRecord(value);
  if (row === null) {
    return null;
  }
  const id = nonEmptyString(row.id);
  const question = nonEmptyString(row.question);
  const options = userInputOptions(row.options);
  if (
    id === null ||
    question === null ||
    options === null ||
    !isOptionalBoolean(row.isOther) ||
    !isOptionalBoolean(row.isSecret)
  ) {
    return null;
  }
  return {
    allowsOther: row.isOther === true || options.length === 0,
    id,
    options,
    question: boundedText(question, "Codex needs input."),
    secret: row.isSecret === true,
  };
}

function userInputQuestions(request: PendingServerRequest): readonly UserInputQuestion[] | null {
  if (request.method !== "item/tool/requestUserInput" || !Array.isArray(request.params.questions)) {
    return null;
  }
  const questions: UserInputQuestion[] = [];
  for (const candidate of request.params.questions) {
    const question = userInputQuestion(candidate);
    if (question === null || questions.some((existing) => existing.id === question.id)) {
      return null;
    }
    questions.push(question);
  }
  return questions.length === 0 ? null : questions;
}

function elicitationOptions(field: Readonly<Record<string, unknown>>): readonly unknown[] {
  const source = field.type === "array" ? unknownRecord(field.items) : field;
  if (source === null) {
    return [];
  }
  if (Array.isArray(source.enum)) {
    return source.enum;
  }
  if (!Array.isArray(source.oneOf)) {
    return [];
  }
  return source.oneOf.flatMap((candidate) => {
    const option = unknownRecord(candidate);
    return option !== null && Object.hasOwn(option, "const") ? [option.const] : [];
  });
}

function optionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === undefined) {
    return null;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function elicitationFieldType(value: unknown): ElicitationField["type"] | null {
  return value === "array" ||
    value === "boolean" ||
    value === "integer" ||
    value === "number" ||
    value === "string"
    ? value
    : null;
}

type ElicitationBounds = Pick<
  ElicitationField,
  "maximum" | "maxItems" | "maxLength" | "minimum" | "minItems" | "minLength"
>;

function elicitationBounds(field: Readonly<Record<string, unknown>>): ElicitationBounds | null {
  const values = {
    maximum: optionalFiniteNumber(field.maximum),
    maxItems: optionalNonNegativeInteger(field.maxItems),
    maxLength: optionalNonNegativeInteger(field.maxLength),
    minimum: optionalFiniteNumber(field.minimum),
    minItems: optionalNonNegativeInteger(field.minItems),
    minLength: optionalNonNegativeInteger(field.minLength),
  };
  if (Object.values(values).some((value) => value === undefined)) {
    return null;
  }
  return {
    maximum: values.maximum ?? null,
    maxItems: values.maxItems ?? null,
    maxLength: values.maxLength ?? null,
    minimum: values.minimum ?? null,
    minItems: values.minItems ?? null,
    minLength: values.minLength ?? null,
  };
}

function elicitationField(
  id: string,
  candidate: unknown,
  required: ReadonlySet<string>,
): ElicitationField | null {
  const field = unknownRecord(candidate);
  if (field === null || nonEmptyString(id) === null) {
    return null;
  }
  const type = elicitationFieldType(field.type);
  const bounds = elicitationBounds(field);
  if (type === null || bounds === null) {
    return null;
  }
  const options = elicitationOptions(field);
  if (type === "array" && options.length === 0) {
    return null;
  }
  return {
    id,
    maximum: bounds.maximum,
    maxItems: bounds.maxItems,
    maxLength: bounds.maxLength,
    minimum: bounds.minimum,
    minItems: bounds.minItems,
    minLength: bounds.minLength,
    options,
    required: required.has(id),
    type,
  };
}

function elicitationSchema(value: unknown): {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: ReadonlySet<string>;
} | null {
  const schema = unknownRecord(value);
  if (schema === null || schema.type !== "object") {
    return null;
  }
  const properties = unknownRecord(schema.properties);
  if (properties === null) {
    return null;
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((candidate): candidate is string => typeof candidate === "string")
      : [],
  );
  return { properties, required };
}

function elicitationFields(request: PendingServerRequest): readonly ElicitationField[] | null {
  if (request.method !== "mcpServer/elicitation/request") {
    return null;
  }
  if (request.params.mode === "url") {
    return [];
  }
  const schema = elicitationSchema(request.params.requestedSchema);
  if (schema === null) {
    return null;
  }
  const fields: ElicitationField[] = [];
  for (const [id, candidate] of Object.entries(schema.properties)) {
    const field = elicitationField(id, candidate, schema.required);
    if (field === null) {
      return null;
    }
    fields.push(field);
  }
  const fieldIds = new Set(fields.map((field) => field.id));
  return [...schema.required].some((id) => !fieldIds.has(id)) ? null : fields;
}

/** Projects only the response contract and bounded user-facing prompt text. */
export function projectGlobalSupervisorPendingRequest(
  request: PendingServerRequest,
): GlobalSupervisorPendingRequestSummary | null {
  const identity: GlobalSupervisorPendingRequestRef = {
    eventId: globalSupervisorPendingRequestEventId(request),
    requestId: request.requestId,
  };
  if (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval"
  ) {
    return {
      ...identity,
      response: { decisions: ["accept", "acceptForSession", "decline"], kind: "approval" },
      summary: boundedText(request.params.reason, "Codex is waiting for approval."),
    };
  }
  if (request.method === "item/permissions/requestApproval") {
    return {
      ...identity,
      response: { decisions: ["allowTurn", "allowSession", "decline"], kind: "permissions" },
      summary: boundedText(request.params.reason, "Codex is waiting for permission approval."),
    };
  }
  const questions = userInputQuestions(request);
  if (questions !== null) {
    return {
      ...identity,
      response: {
        kind: "userInput",
        questions: questions.slice(0, REQUEST_QUESTION_MAX_ENTRIES),
      },
      summary: boundedText(
        questions.map((question) => question.question).join(" "),
        "Codex needs input.",
      ),
    };
  }
  const fields = elicitationFields(request);
  if (fields !== null) {
    const accepts = request.params.mode === "url" || fields.length > 0;
    return {
      ...identity,
      response: {
        actions: accepts ? ["accept", "decline"] : ["decline"],
        fields: fields.slice(0, REQUEST_FIELD_MAX_ENTRIES).map((field) => ({
          id: field.id,
          maximum: field.maximum,
          maxItems: field.maxItems,
          maxLength: field.maxLength,
          minimum: field.minimum,
          minItems: field.minItems,
          minLength: field.minLength,
          options: field.options.flatMap((value) => (typeof value === "string" ? [value] : [])),
          required: field.required,
          type: field.type,
        })),
        kind: "elicitation",
      },
      summary: boundedText(request.params.message, "An external tool is waiting for a response."),
    };
  }
  return null;
}

function validatePrimitive(type: ElicitationField["type"], value: unknown): boolean {
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  return Array.isArray(value);
}

function violatesNumericBounds(field: ElicitationField, value: unknown): boolean {
  if (typeof value !== "number") {
    return false;
  }
  return (
    (field.minimum !== null && value < field.minimum) ||
    (field.maximum !== null && value > field.maximum)
  );
}

function violatesLengthBounds(field: ElicitationField, value: unknown): boolean {
  if (typeof value === "string") {
    return violatesStringLengthBounds(field, value);
  }
  return Array.isArray(value) && violatesArrayLengthBounds(field, value.length);
}

function unicodeCodePointLength(value: string): number {
  let length = 0;
  for (const _character of value) {
    length += 1;
  }
  return length;
}

function violatesStringLengthBounds(field: ElicitationField, value: string): boolean {
  const length = unicodeCodePointLength(value);
  return (
    (field.minLength !== null && length < field.minLength) ||
    (field.maxLength !== null && length > field.maxLength)
  );
}

function violatesArrayLengthBounds(field: ElicitationField, length: number): boolean {
  return (
    (field.minItems !== null && length < field.minItems) ||
    (field.maxItems !== null && length > field.maxItems)
  );
}

function matchesElicitationOptions(field: ElicitationField, value: unknown): boolean {
  if (field.options.length === 0) {
    return true;
  }
  return Array.isArray(value)
    ? value.every((item) => field.options.some((option) => Object.is(option, item)))
    : field.options.some((option) => Object.is(option, value));
}

function userInputResult(
  request: PendingServerRequest,
  answer: Extract<GlobalSupervisorRequestAnswer, { readonly kind: "userInput" }>,
): unknown {
  const questions = userInputQuestions(request);
  if (questions === null || answer.answers.length !== questions.length) {
    throw new Error("The response does not answer the exact pending questions");
  }
  const supplied = explicitUserInputAnswers(answer.answers);
  const responses: Record<string, { readonly answers: readonly string[] }> = {};
  for (const question of questions) {
    const value = validatedUserInputAnswer(question, supplied);
    responses[question.id] = { answers: [value] };
  }
  return { answers: responses };
}

function explicitUserInputAnswers(
  answers: readonly { readonly answer: string; readonly questionId: string }[],
): ReadonlyMap<string, string> {
  const supplied = new Map<string, string>();
  for (const item of answers) {
    const value = item.answer.trim();
    if (supplied.has(item.questionId) || value === "") {
      throw new Error("Each pending question requires one explicit non-empty answer");
    }
    supplied.set(item.questionId, value);
  }
  return supplied;
}

function validatedUserInputAnswer(
  question: UserInputQuestion,
  supplied: ReadonlyMap<string, string>,
): string {
  const value = supplied.get(question.id);
  if (value === undefined) {
    throw new Error("The response does not match the pending question identity");
  }
  if (!question.allowsOther && !question.options.includes(value)) {
    throw new Error("The response is not one of the allowed answers");
  }
  return value;
}

function validatedElicitationContent(
  fields: readonly ElicitationField[],
  content: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const allowed = new Set(fields.map((field) => field.id));
  if (Object.keys(content).some((key) => !allowed.has(key))) {
    throw new Error("The elicitation response contains an unknown field");
  }
  for (const field of fields) {
    validateElicitationField(field, content);
  }
  return content;
}

function validateElicitationField(
  field: ElicitationField,
  content: Readonly<Record<string, unknown>>,
): void {
  const present = Object.hasOwn(content, field.id);
  if (!present) {
    if (field.required) {
      throw new Error("The elicitation response is missing a required field");
    }
    return;
  }
  const value = content[field.id];
  if (!validatePrimitive(field.type, value)) {
    throw new Error("The elicitation response has an invalid field type");
  }
  if (violatesNumericBounds(field, value) || violatesLengthBounds(field, value)) {
    throw new Error("The elicitation response violates the allowed field bounds");
  }
  if (!matchesElicitationOptions(field, value)) {
    throw new Error("The elicitation response is not one of the allowed values");
  }
}

function elicitationResult(
  request: PendingServerRequest,
  answer: Extract<GlobalSupervisorRequestAnswer, { readonly kind: "elicitation" }>,
): unknown {
  const fields = elicitationFields(request);
  if (fields === null) {
    throw new Error("The pending request is not a supported elicitation");
  }
  if (answer.action === "decline") {
    if (answer.content !== null) {
      throw new Error("A declined elicitation cannot include content");
    }
    return { _meta: null, action: "decline", content: null };
  }
  if (request.params.mode === "url") {
    if (answer.content !== null) {
      throw new Error("A URL elicitation response cannot include content");
    }
    return { _meta: null, action: "accept", content: null };
  }
  if (answer.content === null) {
    throw new Error("The accepted elicitation requires typed content");
  }
  return {
    _meta: null,
    action: "accept",
    content: validatedElicitationContent(fields, answer.content),
  };
}

type OptionalRequestResult =
  | { readonly matched: false }
  | { readonly matched: true; readonly value: unknown };

function approvalResult(
  request: PendingServerRequest,
  answer: GlobalSupervisorRequestAnswer,
): OptionalRequestResult {
  if (
    request.method !== "item/commandExecution/requestApproval" &&
    request.method !== "item/fileChange/requestApproval"
  ) {
    return { matched: false };
  }
  return answer.kind === "approval"
    ? { matched: true, value: { decision: answer.decision } }
    : { matched: false };
}

function permissionsResult(
  request: PendingServerRequest,
  answer: GlobalSupervisorRequestAnswer,
): OptionalRequestResult {
  if (request.method !== "item/permissions/requestApproval" || answer.kind !== "permissions") {
    return { matched: false };
  }
  const permissions = answer.decision === "decline" ? {} : (request.params.permissions ?? {});
  const scope = answer.decision === "allowSession" ? "session" : "turn";
  return { matched: true, value: { permissions, scope } };
}

/** Validates a typed explicit response against the exact pending request. */
export function globalSupervisorPendingRequestResult(
  request: PendingServerRequest,
  answer: GlobalSupervisorRequestAnswer,
): unknown {
  const approval = approvalResult(request, answer);
  if (approval.matched) {
    return approval.value;
  }
  const permissions = permissionsResult(request, answer);
  if (permissions.matched) {
    return permissions.value;
  }
  switch (answer.kind) {
    case "userInput":
      if (request.method === "item/tool/requestUserInput") {
        return userInputResult(request, answer);
      }
      break;
    case "elicitation":
      if (request.method === "mcpServer/elicitation/request") {
        return elicitationResult(request, answer);
      }
      break;
    case "approval":
    case "permissions":
      break;
  }
  throw new Error("The typed response is not allowed for this pending request");
}
