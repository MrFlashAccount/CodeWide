import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../../../theme";
import { compactAge } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { MessageAvatar } from "../../messageContent/MessageAvatar";
import { StatusRow } from "../sections/StatusRow";
import { messageAuthor, verdictPhrase } from "./conversationContent";
import type { ReviewerVerdict, StatusSummary } from "./discussionModel";

/**
 * The Status section's Reviews row, from the verdicts on the loaded
 * conversation pages: `alice requested changes · 1 approval`; expanded, one
 * line per reviewer with their standing verdict and its age.
 */
export function ReviewsStatusRow({
  divided,
  nowMs,
  reviewers,
  summary,
}: {
  readonly divided: boolean;
  readonly nowMs: number;
  readonly reviewers: readonly ReviewerVerdict[];
  readonly summary: StatusSummary;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <StatusRow
      detail={summary.label}
      detailTone="muted"
      disclosure={{
        expanded,
        kind: "expandable",
        onToggle: () => {
          setExpanded(!expanded);
        },
      }}
      divided={divided}
      testID="pull-request-status-reviews"
      title="Reviews"
      tone={summary.tone}
    >
      {reviewers.map((reviewer) => (
        <ReviewerLine key={reviewer.author.login} nowMs={nowMs} reviewer={reviewer} />
      ))}
    </StatusRow>
  );
}

function ReviewerLine({
  nowMs,
  reviewer,
}: {
  readonly nowMs: number;
  readonly reviewer: ReviewerVerdict;
}): React.JSX.Element {
  const approved = reviewer.verdict === "approved";
  return (
    <View style={styles.line} testID={`pull-request-status-reviewer-${reviewer.author.login}`}>
      <Ionicons
        color={approved ? colors.success : colors.error}
        name={approved ? "checkmark" : "remove"}
        size={iconSize.inline}
      />
      <MessageAvatar author={messageAuthor(reviewer.author)} size="event" />
      <Text numberOfLines={1} style={styles.text}>
        <Text style={styles.login}>{`${reviewer.author.login} `}</Text>
        {verdictPhrase(reviewer.verdict)}
      </Text>
      <Text style={styles.age}>{compactAge(reviewer.createdAt, nowMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  age: {
    ...typeScale.label,
    color: colors.textDim,
    flexShrink: 0,
  },
  line: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.compact,
  },
  login: {
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  text: {
    ...typeScale.body,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
});
