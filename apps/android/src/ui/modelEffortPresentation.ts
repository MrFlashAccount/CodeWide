/** Formats a model reasoning effort consistently wherever model settings are shown. */
export function modelEffortLabel(value: string): string {
  if (value === "xhigh") {
    return "Extra high";
  }
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
