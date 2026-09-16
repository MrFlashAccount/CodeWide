import type { LegendListProps } from "@legendapp/list/react-native";

/** Runtime lifecycle of one port-forwarding profile. */
export type PortForwardingStatus = "stopped" | "connecting" | "live" | "unavailable" | "error";

/** Lifecycle of remote port discovery for the active server. */
export type PortForwardingDiscoveryStatus = "idle" | "loading" | "ready" | "error";

/** User policy controlling whether a candidate port is forwarded. */
export type PortForwardingPreference = "automatic" | "included" | "excluded";

/** Persisted configuration and runtime state of one forwarded port. */
export type PortForwardingProfile = {
  enabled: boolean;
  error: string | null;
  id: string;
  label: string;
  localPort: number | null;
  preference: PortForwardingPreference;
  preferredLocalPort: number | null;
  previewUrl: string | null;
  remoteHost: string;
  remotePort: number;
  serviceKey: string | null;
  status: PortForwardingStatus;
};

/** Remote listening port that may be promoted into a forwarding profile. */
export type PortForwardingCandidate = {
  cwd: string | null;
  defaultForwardingEnabled: boolean;
  details: string;
  forwardingKey: string;
  group: string;
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
  name: string;
  pid: number | null;
  port: number;
  process: string | null;
};

/** Editable fields used to create or update a forwarding profile. */
export type PortForwardingDraft = {
  label: string;
  preferredLocalPort: number | null;
  remoteHost: "127.0.0.1";
  remotePort: number;
  startImmediately: boolean;
};

/** Complete state and command contract for the port-forwarding manager. */
export type PortForwardingManagerProps = {
  discoveredPorts: readonly PortForwardingCandidate[];
  discoveryError: string | null;
  discoveryStatus: PortForwardingDiscoveryStatus;
  onAdd: (input: PortForwardingDraft) => Promise<void>;
  onEdit: (id: string, input: PortForwardingDraft) => Promise<void>;
  onExcludePort: (port: PortForwardingCandidate) => Promise<void>;
  onOpen: (profile: PortForwardingProfile) => void;
  onReconnect: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSelectPort: (port: PortForwardingCandidate) => Promise<void>;
  onSetPreference: (id: string, preference: PortForwardingPreference) => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  profiles: readonly PortForwardingProfile[];
  renderScrollComponent?: LegendListProps<ServiceListRow>["renderScrollComponent"];
  serverName: string;
};

/** Visible service-list segment selected by the user. */
export type ServiceSegment = "active" | "available" | "excluded";

/** Candidate or configured service rendered within a service segment. */
export type ServiceEntry =
  | { candidate: PortForwardingCandidate; group: string; type: "candidate" }
  | {
      group: string;
      kind: PortForwardingCandidate["kind"];
      profile: PortForwardingProfile;
      type: "profile";
    };

/** Renderable service row, including group separators. */
export type ServiceListRow = ServiceEntry | { group: string; type: "group" };
