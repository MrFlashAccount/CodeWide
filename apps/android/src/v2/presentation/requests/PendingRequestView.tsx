import type { ComponentProps, ReactNode } from "react";

import { useEvent } from "../../../react/useEvent";

import { ApprovalRequestView } from "./ApprovalRequestView";
import { ElicitationRequestView } from "./ElicitationRequestView";
import type {
  ApprovalDecision,
  ElicitationValue,
  PendingRequestViewModel,
  PendingRequestViewResolution,
  UserInputAnswer,
} from "./requestViewModel";
import { UserInputRequestView } from "./UserInputRequestView";
import type { PresentationTextInput } from "../text/ProductText";

interface PendingRequestViewProps {
  embedded: boolean;
  error: string | null;
  model: PendingRequestViewModel;
  onOpenUrl?: ((url: string) => void | Promise<void>) | undefined;
  onResolve(resolution: PendingRequestViewResolution): void;
  pending: boolean;
  position: string | null;
  renderElicitationInput?(
    field: Extract<PendingRequestViewModel, { kind: "elicitation" }>["fields"][number],
    props: ComponentProps<typeof PresentationTextInput>,
  ): ReactNode;
  renderUserInput?(
    question: Extract<PendingRequestViewModel, { kind: "userInput" }>["questions"][number],
    props: ComponentProps<typeof PresentationTextInput>,
  ): ReactNode;
}

export function PendingRequestView(props: PendingRequestViewProps): React.JSX.Element {
  const {
    embedded,
    error,
    model,
    onOpenUrl,
    onResolve,
    pending,
    position,
    renderElicitationInput,
    renderUserInput,
  } = props;
  const resolveApproval = useEvent((decision: ApprovalDecision): void => {
    onResolve({ decision, kind: "approval" });
  });
  const resolveUserInput = useEvent((answers: UserInputAnswer[]): void => {
    onResolve({ answers, kind: "userInput" });
  });
  const resolveElicitation = useEvent((values: ElicitationValue[]): void => {
    onResolve({ action: "accept", kind: "elicitation", values });
  });
  const cancel = useEvent((): void => {
    onResolve({ action: "decline", kind: "elicitation", values: [] });
  });
  if (model.kind === "approval") {
    return (
      <ApprovalRequestView
        embedded={embedded}
        error={error}
        model={model}
        onDecision={resolveApproval}
        pending={pending}
        position={position}
      />
    );
  }
  if (model.kind === "userInput") {
    return (
      <UserInputRequestView
        embedded={embedded}
        error={error}
        model={model}
        onSubmit={resolveUserInput}
        pending={pending}
        position={position}
        {...(renderUserInput === undefined ? {} : { renderInput: renderUserInput })}
      />
    );
  }
  return (
    <ElicitationRequestView
      embedded={embedded}
      error={error}
      model={model}
      onCancel={cancel}
      onOpenUrl={onOpenUrl}
      onSubmit={resolveElicitation}
      pending={pending}
      position={position}
      {...(renderElicitationInput === undefined ? {} : { renderInput: renderElicitationInput })}
    />
  );
}
