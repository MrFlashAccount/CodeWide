import { ActionPressable } from "../../ui/actions/ActionPressable";

interface ReviewLaunchButtonProps {
  actionId: string;
  label?: string;
  onPress(): void | Promise<void>;
}

/** Shared entry control for changes and conversation surfaces. */
export function ReviewLaunchButton(props: ReviewLaunchButtonProps): React.JSX.Element {
  const { actionId, label = "Review", onPress } = props;
  return <ActionPressable action={{ id: actionId, label, run: onPress }} />;
}
