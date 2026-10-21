/** The model a turn ran on, as the server names it, else its id. */
export function turnModelName(
  execution: { readonly model: string; readonly modelLabel?: string | null } | undefined,
): string | null {
  return execution?.modelLabel ?? execution?.model ?? null;
}
