import { useState, type ComponentProps, type ReactNode } from "react";
import { View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationTextInput, ProductText } from "../text/ProductText";
import { RequestActionButton } from "./RequestActionButton";
import { RequestCardShell } from "./RequestCardShell";
import { RequestChoiceView } from "./RequestChoiceView";
import type { ElicitationRequestViewModel, ElicitationValue } from "./requestViewModel";
import { requestStyles } from "./requestStyles";

interface ElicitationRequestViewProps {
  embedded: boolean;
  error: string | null;
  model: ElicitationRequestViewModel;
  onCancel(): void;
  onOpenUrl?: ((url: string) => void | Promise<void>) | undefined;
  onSubmit(values: ElicitationValue[]): void;
  pending: boolean;
  position: string | null;
  renderInput?(
    field: ElicitationRequestViewModel["fields"][number],
    props: ComponentProps<typeof PresentationTextInput>,
  ): ReactNode;
}

type ElicitationDraftValue = readonly string[] | string | null;

export function ElicitationRequestView(props: ElicitationRequestViewProps): React.JSX.Element {
  const { embedded, error, model, onCancel, onOpenUrl, onSubmit, pending, position, renderInput } =
    props;
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const [values, setValues] = useState<Record<string, ElicitationDraftValue>>(() =>
    initialElicitationValues(model.fields),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const submit = useEvent((): void => {
    const result: ElicitationValue[] = [];
    for (const field of model.fields) {
      const value = values[field.id];
      if (value === undefined) {
        if (!field.required) continue;
        setValidationError(`${field.label} is required`);
        return;
      }
      if (value === null) {
        result.push({ fieldId: field.id, value });
        continue;
      }
      if (field.type === "array") {
        const arrayValue = isStringArray(value)
          ? value
          : value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry !== "");
        if (field.required && arrayValue.length === 0) {
          setValidationError(`${field.label} is required`);
          return;
        }
        result.push({ fieldId: field.id, value: arrayValue });
        continue;
      }
      if (isStringArray(value)) {
        setValidationError(`${field.label} has an invalid value`);
        return;
      }
      if (field.required && value.trim() === "") {
        setValidationError(`${field.label} is required`);
        return;
      }
      if (field.type === "number" && !Number.isFinite(Number(value))) {
        setValidationError(`${field.label} must be a number`);
        return;
      }
      if (field.type === "integer" && !Number.isInteger(Number(value))) {
        setValidationError(`${field.label} must be an integer`);
        return;
      }
      result.push({ fieldId: field.id, value });
    }
    setValidationError(null);
    onSubmit(result);
  });
  const openUrl = (): void => {
    if (linkPending || onOpenUrl === undefined || model.url === null) return;
    const url = model.url;
    setLinkError(null);
    setLinkPending(true);
    Promise.resolve()
      .then(() => onOpenUrl(url))
      .catch(() => setLinkError("Could not open this link. Try again."))
      .finally(() => setLinkPending(false));
  };
  return (
    <RequestCardShell
      embedded={embedded}
      error={validationError ?? linkError ?? error}
      pending={pending}
      position={position}
      title={model.title}
    >
      {model.message === "" ? null : (
        <ProductText numberOfLines={3} tone="muted">
          {model.message}
        </ProductText>
      )}
      {model.mode === "url" && model.url !== null ? (
        <ProductText
          accessibilityHint="Opens the secure form"
          accessibilityLabel="Open secure form"
          accessibilityRole={onOpenUrl === undefined ? undefined : "link"}
          disabled={pending || linkPending || onOpenUrl === undefined}
          numberOfLines={2}
          onPress={onOpenUrl === undefined ? undefined : openUrl}
          selectable
          style={[requestStyles.code, onOpenUrl === undefined ? undefined : requestStyles.link]}
        >
          {model.url}
        </ProductText>
      ) : null}
      {model.fields.map((field) => (
        <ElicitationField
          key={field.id}
          disabled={pending}
          field={field}
          onChange={setValues}
          renderInput={renderInput}
          value={values[field.id]}
        />
      ))}
      <View style={requestStyles.actions}>
        <RequestActionButton
          disabled={pending || linkPending}
          label="Decline"
          onPress={onCancel}
          pending={pending}
          tone="danger"
        />
        {model.fields.length === 0 && model.mode !== "url" ? null : (
          <RequestActionButton
            disabled={pending || linkPending}
            label={model.mode === "url" ? "Done" : "Submit"}
            onPress={submit}
            pending={pending}
            tone="primary"
          />
        )}
      </View>
    </RequestCardShell>
  );
}

interface ElicitationFieldProps {
  disabled: boolean;
  field: ElicitationRequestViewModel["fields"][number];
  onChange: React.Dispatch<React.SetStateAction<Record<string, ElicitationDraftValue>>>;
  renderInput?: ElicitationRequestViewProps["renderInput"];
  value: ElicitationDraftValue | undefined;
}

function ElicitationField(props: ElicitationFieldProps): React.JSX.Element {
  const { disabled, field, onChange, renderInput, value } = props;
  const selectedArrayValues = new Set(isStringArray(value) ? value : []);
  const changeValue = useEvent((next: string): void => {
    onChange((current) => ({ ...current, [field.id]: next }));
  });
  const toggleArrayValue = useEvent((next: string): void => {
    onChange((current) => {
      const currentValue = current[field.id];
      const selected = new Set(isStringArray(currentValue) ? currentValue : []);
      if (selected.has(next)) selected.delete(next);
      else selected.add(next);
      return { ...current, [field.id]: [...selected] };
    });
  });
  return (
    <View style={requestStyles.field}>
      <ProductText weight="semibold">
        {field.label}
        {field.required ? " *" : ""}
      </ProductText>
      {field.description === null ? null : (
        <ProductText tone="muted">{field.description}</ProductText>
      )}
      {field.type === "boolean" ? (
        <View accessibilityRole="radiogroup" style={requestStyles.booleanChoices}>
          <RequestChoiceView
            label="Yes"
            onSelect={changeValue}
            selected={value === "true"}
            value="true"
          />
          <RequestChoiceView
            label="No"
            onSelect={changeValue}
            selected={value === "false"}
            value="false"
          />
        </View>
      ) : field.options !== null && field.options.length > 0 ? (
        <View
          accessibilityRole={field.type === "array" ? undefined : "radiogroup"}
          style={requestStyles.booleanChoices}
        >
          {field.options.map((option) => (
            <RequestChoiceView
              key={option.value}
              label={option.label}
              multiple={field.type === "array"}
              onSelect={field.type === "array" ? toggleArrayValue : changeValue}
              selected={
                field.type === "array"
                  ? selectedArrayValues.has(option.value)
                  : value === option.value
              }
              value={option.value}
            />
          ))}
        </View>
      ) : (
        (renderInput?.(field, {
          accessibilityLabel: `Answer ${field.label}`,
          editable: !disabled,
          keyboardType: field.type === "number" || field.type === "integer" ? "numeric" : "default",
          onChangeText: changeValue,
          placeholder: field.type === "array" ? "Comma-separated values" : "Type a value",
          placeholderTextColor: colors.textDim,
          secureTextEntry: field.type === "secret",
          style: requestStyles.input,
          value: typeof value === "string" ? value : "",
        }) ?? (
          <PresentationTextInput
            accessibilityLabel={`Answer ${field.label}`}
            editable={!disabled}
            onChangeText={changeValue}
            keyboardType={
              field.type === "number" || field.type === "integer" ? "numeric" : "default"
            }
            placeholder={field.type === "array" ? "Comma-separated values" : "Type a value"}
            placeholderTextColor={colors.textDim}
            secureTextEntry={field.type === "secret"}
            style={requestStyles.input}
            value={typeof value === "string" ? value : ""}
          />
        ))
      )}
    </View>
  );
}

function initialElicitationValues(
  fields: ElicitationRequestViewModel["fields"],
): Record<string, ElicitationDraftValue> {
  const values: Record<string, ElicitationDraftValue> = {};
  for (const field of fields) {
    if (field.defaultValue.kind === "unset") continue;
    const value = field.defaultValue.value;
    values[field.id] =
      typeof value === "boolean" || typeof value === "number" ? String(value) : value;
  }
  return values;
}

function isStringArray(value: ElicitationDraftValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}
