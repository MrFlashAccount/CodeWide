export function mergeFailedComposerText(current: string, failed: string): string {
  if (failed === "" || current === failed) {
    return current;
  }
  if (current === "") {
    return failed;
  }
  return `${failed}\n\n${current}`;
}

export function mergeFailedComposerAttachments<Attachment extends { id: string }>(
  current: Attachment[],
  failed: Attachment[],
): Attachment[] {
  if (failed.length === 0) {
    return current;
  }
  const failedIds = new Set(failed.map((attachment) => attachment.id));
  return [...failed, ...current.filter((attachment) => !failedIds.has(attachment.id))];
}

export function rollbackOwnedModelSelection(
  current: { effort: string | null; model: string | null },
  attempted: { effort: string; model: string },
  previous: { effort: string | null; model: string | null },
  ownership: { effort: boolean; model: boolean },
): { effort: string | null; model: string | null } {
  return {
    effort:
      ownership.effort && current.effort === attempted.effort ? previous.effort : current.effort,
    model: ownership.model && current.model === attempted.model ? previous.model : current.model,
  };
}
