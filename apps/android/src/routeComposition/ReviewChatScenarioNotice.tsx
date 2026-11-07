import { useRef } from "react";
import { Pressable, View, type Text as NativeText } from "react-native";

import { TextShimmer } from "../ui/TextShimmer";
import { AppText as Text } from "../ui/Typography";
import { pullRequestReviewChatStyles as styles } from "./PullRequestReviewChatPane.styles";
import type { ReviewChatDraftScenario } from "./reviewChatDraft";

/**
 * The scenario waiting in the review-chat draft. It starts only on confirmation, in the chosen
 * project; until one is chosen the start is disabled. While it starts its label shimmers in
 * place, and a refusal stays here with the Companion's reason.
 */
export function ReviewChatScenarioNotice({
  onStart,
  projectChosen,
  scenario,
}: {
  readonly onStart: () => void;
  readonly projectChosen: boolean;
  readonly scenario: ReviewChatDraftScenario;
}): React.JSX.Element {
  const label = useRef<NativeText>(null);
  const starting = scenario.status === "starting";
  const disabled = starting || !projectChosen;
  const startLabel = `Start ${scenario.label}`;
  return (
    <View style={styles.scenario} testID="review-chat-pending-scenario">
      <Text style={styles.scenarioText}>{`${scenario.label} will start in this chat`}</Text>
      {scenario.status === "pending" && scenario.error !== null ? (
        <Text style={styles.scenarioError}>{scenario.error}</Text>
      ) : null}
      <Pressable
        accessibilityHint={projectChosen ? undefined : "Choose a project first"}
        accessibilityLabel={startLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: starting, disabled }}
        disabled={disabled}
        onPress={onStart}
        style={({ pressed }) => [
          styles.scenarioStart,
          !projectChosen && styles.scenarioDisabled,
          pressed && styles.scenarioPressed,
        ]}
      >
        <Text numberOfLines={1} ref={label} style={styles.scenarioStartLabel}>
          {startLabel}
        </Text>
        <TextShimmer shimmering={starting} target={label} />
      </Pressable>
    </View>
  );
}
