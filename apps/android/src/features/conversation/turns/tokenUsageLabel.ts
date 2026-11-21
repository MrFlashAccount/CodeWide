import { formatLocaleNumber } from "../../../ui/number-format";

/** Exact localized input and output counts for the footer’s accessibility label. */
export function tokenUsageLabel(input: number, output: number): string {
  return `${formatLocaleNumber(input)} input tokens, ${formatLocaleNumber(output)} output tokens`;
}
