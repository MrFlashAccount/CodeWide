export function mergeFailedComposerText(current: string, failed: string): string {
  if (failed === "" || current === failed) return current;
  if (current === "") return failed;
  return `${failed}\n\n${current}`;
}

export function mergeFailedComposerAttachments<Attachment extends { id: string }>(
  current: Attachment[],
  failed: Attachment[],
): Attachment[] {
  if (failed.length === 0) return current;
  const failedIds = new Set(failed.map((attachment) => attachment.id));
  return [...failed, ...current.filter((attachment) => !failedIds.has(attachment.id))];
}

export function rollbackOwnedModelSelection(
  current: { model: string | null; effort: string | null },
  attempted: { model: string; effort: string },
  previous: { model: string | null; effort: string | null },
  ownership: { model: boolean; effort: boolean },
): { model: string | null; effort: string | null } {
  return {
    model: ownership.model && current.model === attempted.model ? previous.model : current.model,
    effort: ownership.effort && current.effort === attempted.effort ? previous.effort : current.effort,
  };
}
