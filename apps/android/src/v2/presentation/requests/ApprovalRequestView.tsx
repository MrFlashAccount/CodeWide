import { View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { ProductText } from "../text/ProductText";
import { RequestActionButton } from "./RequestActionButton";
import { RequestCardShell } from "./RequestCardShell";
import type { ApprovalDecision, ApprovalRequestViewModel } from "./requestViewModel";
import { requestStyles } from "./requestStyles";

interface ApprovalRequestViewProps {
  embedded: boolean;
  error: string | null;
  model: ApprovalRequestViewModel;
  onDecision(decision: ApprovalDecision): void;
  pending: boolean;
  position: string | null;
}

export function ApprovalRequestView(props: ApprovalRequestViewProps): React.JSX.Element {
  const { embedded, error, model, onDecision, pending, position } = props;
  return (
    <RequestCardShell
      embedded={embedded}
      error={error}
      pending={pending}
      position={position}
      title={approvalTitle(model)}
    >
      {model.reason === null ? null : (
        <ProductText numberOfLines={2} tone="muted">
          {model.reason}
        </ProductText>
      )}
      <ProductText numberOfLines={4} selectable style={requestStyles.code}>
        {model.summary}
      </ProductText>
      {model.detail === null ? null : (
        <ProductText numberOfLines={1} selectable tone="dim">
          {model.detail}
        </ProductText>
      )}
      <View style={requestStyles.actions}>
        {model.availableDecisions.map((decision) => (
          <ApprovalDecisionButton
            key={approvalDecisionKey(decision)}
            decision={decision}
            disabled={pending}
            onDecision={onDecision}
          />
        ))}
      </View>
    </RequestCardShell>
  );
}

function approvalTitle(model: ApprovalRequestViewModel): string {
  if (model.approvalKind === "commandApproval") return "Command approval";
  if (model.approvalKind === "fileChangeApproval") return "File change approval";
  return "Additional permissions";
}

interface ApprovalDecisionButtonProps {
  decision: ApprovalDecision;
  disabled: boolean;
  onDecision(decision: ApprovalDecision): void;
}

function ApprovalDecisionButton(props: ApprovalDecisionButtonProps): React.JSX.Element {
  const { decision, disabled, onDecision } = props;
  const select = useEvent(() => onDecision(decision));
  return (
    <RequestActionButton
      disabled={disabled}
      label={approvalDecisionLabel(decision)}
      onPress={select}
      pending={disabled}
      tone={approvalDecisionTone(decision)}
    />
  );
}

function approvalDecisionLabel(decision: ApprovalDecision): string {
  if (decision === "accept") return "Accept once";
  if (decision === "acceptForSession") return "For session";
  if (decision === "decline") return "Decline";
  if (decision === "cancel") return "Cancel";
  if ("acceptWithExecpolicyAmendment" in decision) return "Accept and remember";
  if ("applyNetworkPolicyAmendment" in decision) return "Apply network rule";
  return unreachableApprovalDecision(decision);
}

function approvalDecisionTone(decision: ApprovalDecision): "danger" | "primary" | "secondary" {
  if (decision === "accept") return "primary";
  if (decision === "acceptForSession") return "secondary";
  if (decision === "decline" || decision === "cancel") return "danger";
  return "secondary";
}

function approvalDecisionKey(decision: ApprovalDecision): string {
  if (typeof decision === "string") return decision;
  if ("acceptWithExecpolicyAmendment" in decision) {
    return "acceptWithExecpolicyAmendment";
  }
  if ("applyNetworkPolicyAmendment" in decision) {
    return "applyNetworkPolicyAmendment";
  }
  return unreachableApprovalDecision(decision);
}

function unreachableApprovalDecision(decision: never): never {
  throw new Error(`Unsupported approval decision: ${String(decision)}`);
}
