import { ResourceComposerMenu } from "./ComposerMenu";
import type { ComposerToolRouteRequest } from "../../services/composer/composerToolRouteSession";

type ControlRouteRequest = Extract<
  ComposerToolRouteRequest,
  { readonly kind: "model" | "permissions" | "skills" }
>;

/** Presents one explicit composer-control route with its captured selection commands. */
export function ComposerControlRoute({
  onClose,
  request,
  visible,
}: {
  readonly onClose: () => void;
  readonly request: ControlRouteRequest;
  readonly visible: boolean;
}): React.JSX.Element {
  return (
    <ResourceComposerMenu
      controlError={request.controlError}
      controlsResourceId={request.controlsResourceId}
      hideTitle={false}
      initialPage={request.kind}
      newChat={request.newChat}
      onClose={onClose}
      onInvokeSkill={request.invokeSkill}
      onSelectEffort={request.selectEffort}
      onSelectModel={request.selectModel}
      onSelectPermissions={request.selectPermissions}
      onSelectPersonality={request.selectPersonality}
      resources={request.resources}
      selectedEffort={request.selectedEffort}
      selectedModel={request.selectedModel}
      selectedPermissions={request.selectedPermissions}
      selectedPersonality={request.selectedPersonality}
      thread={request.thread}
      toolPage={null}
      visible={visible}
      voiceScope={request.voiceScope}
      {...(request.getTransferAccess === undefined
        ? {}
        : { getTransferAccess: request.getTransferAccess })}
    />
  );
}
