export function selectionAsync(): Promise<void> {
  return Promise.resolve();
}

export const ImpactFeedbackStyle = { Light: "light" } as const;

export function impactAsync(_style: string): Promise<void> {
  return Promise.resolve();
}
