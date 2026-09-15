/** V1 RequestFeature owner, extracted without changing interaction or resource lifetime. */
import { ScrollView, View } from "react-native";
import { ControlOption } from "../../ui/ControlOption";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { mcpElicitationFields } from "./elicitationForm";
import { styles } from "./RequestFeature.styles";

import type { Dispatch, SetStateAction } from "react";
type RequestFieldsProps = {
  questions: Record<string, unknown>[];
  elicitationFields: ReturnType<typeof mcpElicitationFields>;
  answers: Record<string, string>;
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>;
};

export function RequestFields({
  questions,
  elicitationFields,
  answers,
  setAnswers,
}: RequestFieldsProps) {
  return (
    <>
      {questions.map((question) => {
        const id = typeof question.id === "string" ? question.id : "question";
        const label = typeof question.question === "string" ? question.question : id;
        const options = Array.isArray(question.options) ? question.options : [];
        return (
          <View key={id} style={styles.approvalQuestion}>
            <Text style={styles.menuActionTitle}>{label}</Text>
            {options.length > 0 && (
              <ScrollView horizontal contentContainerStyle={styles.answerOptions}>
                {options.map((option, index) => {
                  const value =
                    option !== null &&
                    typeof option === "object" &&
                    "label" in option &&
                    typeof option.label === "string"
                      ? option.label
                      : `Option ${index + 1}`;
                  return (
                    <ControlOption
                      key={value}
                      title={value}
                      selected={answers[id] === value}
                      onPress={() => setAnswers((current) => ({ ...current, [id]: value }))}
                    />
                  );
                })}
              </ScrollView>
            )}
            <TextInput
              accessibilityLabel={`Answer ${label}`}
              secureTextEntry={question.isSecret === true}
              value={answers[id] ?? ""}
              onChangeText={(value) => setAnswers((current) => ({ ...current, [id]: value }))}
              style={styles.approvalInput}
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
            <ScrollView horizontal contentContainerStyle={styles.answerOptions}>
              {field.options.map((option) => (
                <ControlOption
                  key={option.value}
                  title={option.label}
                  selected={(answers[field.id] ?? field.defaultValue) === option.value}
                  onPress={() =>
                    setAnswers((current) => ({ ...current, [field.id]: option.value }))
                  }
                />
              ))}
            </ScrollView>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${field.label}`}
              keyboardType={
                field.type === "number" || field.type === "integer" ? "numeric" : "default"
              }
              value={answers[field.id] ?? field.defaultValue}
              onChangeText={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
              style={styles.approvalInput}
            />
          )}
        </View>
      ))}
    </>
  );
}
