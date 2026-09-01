export function useNativePortForwarding(): {
  discoveredPorts: readonly never[];
  discoveryError: null;
  discoveryStatus: "ready";
  profiles: readonly { id: string }[];
} {
  return {
    discoveredPorts: [],
    discoveryError: null,
    discoveryStatus: "ready",
    profiles: [{ id: "materialized-port-profile" }],
  };
}
