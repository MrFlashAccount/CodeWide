const DECIMAL_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const INTEGER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function diagnosticDecimal(value: number): string {
  return DECIMAL_FORMAT.format(value);
}

export function diagnosticInteger(value: number): string {
  return INTEGER_FORMAT.format(value);
}

export function diagnosticPercent(value: number): string {
  return `${diagnosticDecimal(value)}%`;
}

export function diagnosticBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "unavailable";
  if (value < 1024) return `${diagnosticInteger(value)} B`;
  if (value < 1_048_576) return `${diagnosticDecimal(value / 1024)} KB`;
  if (value < 1_073_741_824) return `${diagnosticDecimal(value / 1_048_576)} MB`;
  return `${diagnosticDecimal(value / 1_073_741_824)} GB`;
}

export function diagnosticRate(value: number): string {
  return value < 0 ? "unavailable" : `${diagnosticBytes(value)}/s`;
}
