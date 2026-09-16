export function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${decimal(value)}`;
}

const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function decimal(value: number): string {
  return decimalFormat.format(value);
}

export function integer(value: number): string {
  return integerFormat.format(value);
}

export function percent(value: number): string {
  return `${decimal(value)}%`;
}

export function ratio(numerator: number, denominator: number): string {
  return denominator === 0 ? "—" : decimal(numerator / denominator);
}

export function bytes(value: number): string {
  if (value < 1024) {
    return `${integer(value)} B`;
  }
  if (value < 1_048_576) {
    return `${decimal(value / 1024)} KB`;
  }
  if (value < 1_073_741_824) {
    return `${decimal(value / 1_048_576)} MB`;
  }
  return `${decimal(value / 1_073_741_824)} GB`;
}

export function bytesOrUnavailable(value: number): string {
  return value < 0 ? "unavailable" : bytes(value);
}

export function rate(value: number): string {
  return value < 0 ? "unavailable" : `${bytes(value)}/s`;
}

export function duration(valueMs: number): string {
  const totalSeconds = Math.floor(valueMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes)}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  return `${String(seconds)}s`;
}
