let nextUuid = 0;

export function randomUUID(): string {
  nextUuid += 1;
  return `00000000-0000-4000-8000-${String(nextUuid).padStart(12, "0")}`;
}
