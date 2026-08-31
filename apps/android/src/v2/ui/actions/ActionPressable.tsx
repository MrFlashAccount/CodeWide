import { ActionButtonView } from "../../../presentation/actions/ActionButtonView";

import type { Action } from "./action";
import { useActionRunner } from "./ActionRunner";
import { useEvent } from "../../../react/useEvent";

interface ActionPressableProps {
  action: Action;
}

export function ActionPressable({ action }: ActionPressableProps): React.JSX.Element {
  const runner = useActionRunner();
  const pending = runner.active === action.id;
  const failure = runner.failures[action.id];
  const run = useEvent(() => runner.run(action));
  return (
    <ActionButtonView
      disabled={action.disabled === true || pending}
      {...(failure === undefined ? {} : { error: failure })}
      label={action.label}
      onPress={run}
      pending={pending}
    />
  );
}
