import { RouteUnavailable } from "./RouteUnavailable";

/** Presents deterministic recovery when a retained tool activation is unavailable. */
export function RouteToolUnavailable({
  onBack,
  title,
}: {
  readonly onBack: () => void;
  readonly title: string;
}): React.JSX.Element {
  return (
    <RouteUnavailable
      message="Return to the conversation and open this tool again."
      onBack={onBack}
      title={`${title} unavailable`}
    />
  );
}
