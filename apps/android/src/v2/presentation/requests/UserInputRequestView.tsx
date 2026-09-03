import { useState, type ComponentProps, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationTextInput, ProductText } from "../text/ProductText";
import { RequestActionButton } from "./RequestActionButton";
import { RequestCardShell } from "./RequestCardShell";
import { RequestChoiceView } from "./RequestChoiceView";
import type { UserInputAnswer, UserInputRequestViewModel } from "./requestViewModel";
import { requestStyles } from "./requestStyles";

interface UserInputRequestViewProps {
  embedded: boolean;
  error: string | null;
  model: UserInputRequestViewModel;
  onSubmit(answers: UserInputAnswer[]): void;
  pending: boolean;
  position: string | null;
  renderInput?(
    question: UserInputRequestViewModel["questions"][number],
    props: ComponentProps<typeof PresentationTextInput>,
  ): ReactNode;
}

export function UserInputRequestView(props: UserInputRequestViewProps): React.JSX.Element {
  const { embedded, error, model, onSubmit, pending, position, renderInput } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = useEvent((): void => {
    const result = model.questions.map((question): UserInputAnswer => ({
      answers: [answers[question.id] ?? ""],
      questionId: question.id,
    }));
    onSubmit(result);
  });
  return (
    <RequestCardShell
      embedded={embedded}
      error={error}
      pending={pending}
      position={position}
      title="Codex needs input"
    >
      {model.questions.map((question) => (
        <UserInputQuestionField
          key={question.id}
          disabled={pending}
          onChange={setAnswers}
          question={question}
          renderInput={renderInput}
          value={answers[question.id] ?? ""}
        />
      ))}
      <View style={requestStyles.actions}>
        <RequestActionButton
          disabled={pending}
          label="Submit"
          onPress={submit}
          pending={pending}
          tone="primary"
        />
      </View>
    </RequestCardShell>
  );
}

interface UserInputQuestionFieldProps {
  disabled: boolean;
  onChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  question: UserInputRequestViewModel["questions"][number];
  renderInput?: UserInputRequestViewProps["renderInput"];
  value: string;
}

function UserInputQuestionField(props: UserInputQuestionFieldProps): React.JSX.Element {
  const { disabled, onChange, question, renderInput, value } = props;
  const changeValue = useEvent((next: string): void => {
    onChange((current) => ({ ...current, [question.id]: next }));
  });
  return (
    <View style={requestStyles.field}>
      <ProductText weight="semibold">
        {question.header === "" ? question.question : question.header}
      </ProductText>
      {question.header === "" || question.header === question.question ? null : (
        <ProductText tone="muted">{question.question}</ProductText>
      )}
      {question.options === null || question.options.length === 0 ? null : (
        <ScrollView
          accessibilityRole="radiogroup"
          contentContainerStyle={requestStyles.choices}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {question.options.map((option) => (
            <RequestChoiceView
              key={option.label}
              description={option.description}
              label={option.label}
              onSelect={changeValue}
              selected={value === option.label}
              value={option.label}
            />
          ))}
        </ScrollView>
      )}
      {renderInput?.(question, {
        accessibilityLabel: `Answer ${question.question}`,
        editable: !disabled,
        onChangeText: changeValue,
        placeholder: question.isOther ? "Type another answer" : "Type an answer",
        placeholderTextColor: colors.textDim,
        secureTextEntry: question.isSecret,
        style: requestStyles.input,
        value,
      }) ?? (
        <PresentationTextInput
          accessibilityLabel={`Answer ${question.question}`}
          editable={!disabled}
          onChangeText={changeValue}
          placeholder={question.isOther ? "Type another answer" : "Type an answer"}
          placeholderTextColor={colors.textDim}
          secureTextEntry={question.isSecret}
          style={requestStyles.input}
          value={value}
        />
      )}
    </View>
  );
}
