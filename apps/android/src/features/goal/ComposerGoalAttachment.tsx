import { AttachmentCard } from "../../rendering/AttachmentCard";

type ComposerGoalAttachmentProps = {
  readonly onClose: () => void;
};

/** Marks the main composer text as the objective for the next goal submission. */
export function ComposerGoalAttachment({
  onClose,
}: ComposerGoalAttachmentProps): React.JSX.Element {
  return (
    <AttachmentCard
      compact
      icon="flag-outline"
      label="Objective"
      name="Goal"
      onRemove={onClose}
      testID="composer-goal-attachment"
    />
  );
}
