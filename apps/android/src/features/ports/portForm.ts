import { useState } from "react";
import { useEvent } from "../../react/useEvent";
import type {
  PortForwardingDraft,
  PortForwardingManagerProps,
  PortForwardingProfile,
} from "./portForwardingContract";
import { EMPTY_FORM, message, parseForwardingDraft, type FormState } from "./portForwardingForm";

export function usePortForm(props: PortForwardingManagerProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [navigationDirection, setNavigationDirection] = useState<"back" | "forward" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const closeForm = useEvent(() => {
    setNavigationDirection("back");
    setForm(null);
    setFormError(null);
  });
  const openManual = useEvent(() => {
    setNavigationDirection("forward");
    setForm(EMPTY_FORM);
    setFormError(null);
  });
  const openEdit = useEvent((profile: PortForwardingProfile) => {
    setNavigationDirection("forward");
    setForm({
      id: profile.id,
      label: profile.label,
      localPort: profile.preferredLocalPort === null ? "" : String(profile.preferredLocalPort),
      remotePort: String(profile.remotePort),
      startImmediately: profile.enabled,
    });
    setFormError(null);
  });
  const submit = useEvent(async () => {
    if (form === null) {
      return;
    }
    let draft: PortForwardingDraft;
    try {
      draft = parseForwardingDraft(form);
    } catch (error) {
      setFormError(message(error, "Check the port values"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (form.id === null) {
        await props.onAdd(draft);
      } else {
        await props.onEdit(form.id, draft);
      }
      closeForm();
    } catch (error) {
      setFormError(message(error, "Could not save port forwarding"));
    }
    setSubmitting(false);
  });
  const removeCurrent = useEvent(async () => {
    if (form?.id === null || form?.id === undefined) {
      return;
    }
    setSubmitting(true);
    try {
      await props.onRemove(form.id);
      closeForm();
    } catch (error) {
      setFormError(message(error, "Could not remove port forwarding"));
    }
    setSubmitting(false);
  });
  return {
    closeForm,
    form,
    formError,
    navigationDirection,
    openEdit,
    openManual,
    removeCurrent,
    setForm,
    submit,
    submitting,
  };
}
