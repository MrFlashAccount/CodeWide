/** V1 RequestFeature owner, extracted without changing interaction or resource lifetime. */
import { ScrollView, View } from "react-native";
import { occurrenceKey } from "../../rendering/listKey";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import type { mcpElicitationFields } from "./elicitationForm";
import { styles } from "./RequestFeature.styles";

import type { Dispatch, SetStateAction } from "react";

type RequestFieldsProps = {
  answers: Record<string, string>;
  elicitationFields: ReturnType<typeof mcpElicitationFields>;
  questions: Record<string, unknown>[];
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>;
};

export function RequestFields({
  answers,
  elicitationFields,
  questions,
  setAnswers,
}: RequestFieldsProps) {
  return (
    <>
      {questions.map((question) => {
        const id = typeof question.id === "string" ? question.id : "question";
        const label = typeof question.question === "string" ? question.question : id;
        const options: readonly unknown[] = Array.isArray(question.options) ? question.options : [];
        const optionOccurrences = new Map<string, number>();
        return (
          <View key={id} style={styles.approvalQuestion}>
            <Text style={styles.menuActionTitle}>{label}</Text>
            {options.length > 0 && (
              <ScrollView contentContainerStyle={styles.answerOptions} horizontal>
                {options.map((option, index) => {
                  const value =
                    option !== null &&
                    typeof option === "object" &&
                    "label" in option &&
                    typeof option.label === "string"
                      ? option.label
                      : `Option ${String(index + 1)}`;
                  const key = occurrenceKey(
                    optionOccurrences,
                    typeof option === "object" && option !== null && "label" in option
                      ? `label:${String(option.label)}`
                      : `invalid:${typeof option}`,
                  );
                  return (
                    <ControlOption
                      key={key}
                      onPress={() => {
                        setAnswers((current) => ({ ...current, [id]: value }));
                      }}
                      selected={answers[id] === value}
                      title={value}
                    />
                  );
                })}
              </ScrollView>
            )}
            <TextInput
              accessibilityLabel={`Answer ${label}`}
              onChangeText={(value) => {
                setAnswers((current) => ({ ...current, [id]: value }));
              }}
              secureTextEntry={question.isSecret === true}
              style={styles.approvalInput}
              value={answers[id] ?? ""}
            />
          </View>
        );
      })}
      {elicitationFields.map((field) => (
        <View key={field.id} style={styles.approvalQuestion}>
          <Text style={styles.menuActionTitle}>
            {field.label}
            {field.required ? " *" : ""}
          </Text>
          {field.description !== null && (
            <Text style={styles.menuActionSubtitle}>{field.description}</Text>
          )}
          {field.options.length > 0 ? (
            <ScrollView contentContainerStyle={styles.answerOptions} horizontal>
              {field.options.map((option) => (
                <ControlOption
                  key={option.value}
                  onPress={() => {
                    setAnswers((current) => ({ ...current, [field.id]: option.value }));
                  }}
                  selected={(answers[field.id] ?? field.defaultValue) === option.value}
                  title={option.label}
                />
              ))}
            </ScrollView>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${field.label}`}
              keyboardType={
                field.type === "number" || field.type === "integer" ? "numeric" : "default"
              }
              onChangeText={(value) => {
                setAnswers((current) => ({ ...current, [field.id]: value }));
              }}
              style={styles.approvalInput}
              value={answers[field.id] ?? field.defaultValue}
            />
          )}
        </View>
      ))}
    </>
  );
}
