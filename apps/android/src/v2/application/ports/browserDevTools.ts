export interface BrowserDevToolsEndpoint {
  host: "127.0.0.1";
  port: number;
  token: string;
  tracingSupported: boolean;
}

export interface BrowserTrace {
  path: string;
  size: number;
}

export type DevToolsDockSide = "bottom" | "left" | "right" | "undocked";

/** Native capability required by the transport-neutral internal browser. */
export interface BrowserDevToolsCapability {
  start(): Promise<BrowserDevToolsEndpoint>;
  startTracing(): Promise<void>;
  stop(): void;
  stopTracing(): Promise<BrowserTrace>;
}
