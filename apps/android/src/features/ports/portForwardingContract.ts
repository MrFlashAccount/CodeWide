import type { LegendListProps } from "@legendapp/list/react-native";

export type PortForwardingStatus = "stopped" | "connecting" | "live" | "unavailable" | "error";

export type PortForwardingDiscoveryStatus = "idle" | "loading" | "ready" | "error";

export type PortForwardingPreference = "automatic" | "included" | "excluded";

export type PortForwardingProfile = {
  id: string;
  label: string;
  remoteHost: string;
  remotePort: number;
  preferredLocalPort: number | null;
  serviceKey: string | null;
  preference: PortForwardingPreference;
  localPort: number | null;
  enabled: boolean;
  status: PortForwardingStatus;
  previewUrl: string | null;
  error: string | null;
};

export type PortForwardingCandidate = {
  port: number;
  name: string;
  group: string;
  details: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind:
    | "docker"
    | "hermes"
    | "kubernetes"
    | "minikube"
    | "vite"
    | "node"
    | "python"
    | "zrok"
    | "process"
    | "system";
  forwardingKey: string;
  defaultForwardingEnabled: boolean;
};

export type PortForwardingDraft = {
  label: string;
  remoteHost: "127.0.0.1";
  remotePort: number;
  preferredLocalPort: number | null;
  startImmediately: boolean;
};

export type PortForwardingManagerProps = {
  serverName: string;
  profiles: readonly PortForwardingProfile[];
  discoveredPorts: readonly PortForwardingCandidate[];
  discoveryStatus: PortForwardingDiscoveryStatus;
  discoveryError: string | null;
  onOpen(profile: PortForwardingProfile): void;
  onSelectPort(port: PortForwardingCandidate): Promise<void>;
  onExcludePort(port: PortForwardingCandidate): Promise<void>;
  onAdd(input: PortForwardingDraft): Promise<void>;
  onEdit(id: string, input: PortForwardingDraft): Promise<void>;
  onStart(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onReconnect(id: string): Promise<void>;
  onRemove(id: string): Promise<void>;
  onSetPreference(id: string, preference: PortForwardingPreference): Promise<void>;
  renderScrollComponent?: LegendListProps<ServiceListRow>["renderScrollComponent"];
};

export type ServiceSegment = "active" | "available" | "excluded";

export type ServiceEntry =
  | { type: "candidate"; group: string; candidate: PortForwardingCandidate }
  | {
      type: "profile";
      group: string;
      profile: PortForwardingProfile;
      kind: PortForwardingCandidate["kind"];
    };

export type ServiceListRow = ServiceEntry | { type: "group"; group: string };
