export interface V2Telemetry {
  event(name: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}
