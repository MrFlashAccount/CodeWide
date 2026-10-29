import { useContext } from "react";
import { Pressable, useWindowDimensions } from "react-native";

import { useEvent } from "../../react/useEvent";
import { ActionMenu } from "../../ui/ActionMenu";
import { ForgeIcon } from "../../ui/ForgeIcon";
import { inlineIconMetrics } from "../../ui/inline-icon-metrics";
import { ComposerContextLabel } from "../../ui/ResourceContextChip";
import {
  ComposerLinkedPullRequestContext,
  type ComposerLinkedPullRequests,
} from "./composerLinkedPullRequest";
import { styles } from "./ComposerPullRequestContextChip.styles";

/**
 * Context chip for the pull request linked to the current thread: the forge mark and `#115`.
 * Tap opens the most relevant one; with several links the label adds `+N` and a long press
 * offers every linked pull request. Renders nothing when the route supplies no link.
 */
export function ComposerPullRequestContextChip(): React.JSX.Element | null {
  const linked = useContext(ComposerLinkedPullRequestContext);
  return linked === null ? null : <ComposerPullRequestContextChipView linked={linked} />;
}

function ComposerPullRequestContextChipView({
  linked,
}: {
  readonly linked: ComposerLinkedPullRequests;
}): React.JSX.Element {
  const { fontScale } = useWindowDimensions();
  const [primary, ...others] = linked.items;
  const openPrimary = useEvent((): void => {
    linked.open(primary.id);
  });
  const label = others.length === 0 ? primary.label : `${primary.label} +${String(others.length)}`;
  const chip = (
    <Pressable
      accessibilityLabel={
        others.length === 0
          ? `Open pull request ${primary.label}`
          : `Open pull request ${primary.label}. ${String(others.length)} more linked; long press to choose.`
      }
      accessibilityRole="button"
      onPress={openPrimary}
      style={styles.composerContextChip}
      testID="composer-pull-request-chip"
    >
      <ForgeIcon icon={primary.icon} size={inlineIconMetrics("label", fontScale).glyph} />
      <ComposerContextLabel testID="composer-pull-request-label" text={label} />
    </Pressable>
  );
  if (others.length === 0) {
    return chip;
  }
  return (
    <ActionMenu
      accessibilityLabel="Choose linked pull request"
      actions={linked.items.map((item) => ({
        icon: "git-pull-request-outline",
        id: item.id,
        label: `Pull request ${item.label}`,
      }))}
      align="start"
      onSelect={linked.open}
      placement="top"
      trigger="long-press"
    >
      {chip}
    </ActionMenu>
  );
}
