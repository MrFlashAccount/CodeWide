import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/** One stable inventory for persisted server icon ids and their presentation metadata. */
export const serverIconOptions = [
  { id: "desktop", label: "Desktop", legacyEmoji: ["🖥️", "🖥"], name: "desktop-outline" },
  { id: "laptop", label: "Laptop", legacyEmoji: ["💻"], name: "laptop-outline" },
  { id: "server", label: "Server", legacyEmoji: ["🗄️", "🗄"], name: "server-outline" },
  { id: "terminal", label: "Terminal", legacyEmoji: ["⌨️", "⌨", "🧪"], name: "terminal-outline" },
  { id: "cloud", label: "Cloud", legacyEmoji: ["☁️", "☁", "🚀"], name: "cloud-outline" },
  { id: "network", label: "Network", legacyEmoji: ["🌐"], name: "git-network-outline" },
  { id: "globe", label: "Globe", legacyEmoji: ["🌍", "🌎", "🌏"], name: "globe-outline" },
  { id: "chip", label: "Compute chip", legacyEmoji: ["🧠"], name: "hardware-chip-outline" },
  { id: "code", label: "Code host", legacyEmoji: ["👨🏽‍💻", "👨‍💻", "👩‍💻"], name: "code-slash-outline" },
  { id: "cluster", label: "Cluster", legacyEmoji: [], name: "layers-outline" },
  { id: "container", label: "Container", legacyEmoji: ["📦"], name: "cube-outline" },
  { id: "wifi", label: "Wireless host", legacyEmoji: ["📶"], name: "wifi-outline" },
  { id: "radio", label: "Radio node", legacyEmoji: ["📡"], name: "radio-outline" },
  { id: "phone", label: "Phone", legacyEmoji: ["📱"], name: "phone-portrait-outline" },
  { id: "tablet", label: "Tablet", legacyEmoji: [], name: "tablet-portrait-outline" },
  { id: "office", label: "Office server", legacyEmoji: ["🏢", "🏠"], name: "business-outline" },
  { id: "build", label: "Build server", legacyEmoji: ["🛠️", "🛠"], name: "construct-outline" },
  {
    id: "managed",
    label: "Managed server",
    legacyEmoji: ["⚙️", "⚙", "🔒"],
    name: "settings-outline",
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly legacyEmoji: readonly string[];
  readonly name: IoniconName;
}[];

/** A validated stable identifier from the persisted server icon inventory. */
export type ServerIconId = (typeof serverIconOptions)[number]["id"];
type ServerIconOption = (typeof serverIconOptions)[number];

const DEFAULT_SERVER_ICON_ID: ServerIconId = "desktop";

/** Narrows untrusted input to an icon id owned by the fixed inventory. */
export function isServerIconId(value: unknown): value is ServerIconId {
  return typeof value === "string" && serverIconOptions.some((option) => option.id === value);
}

/** Old pairing payloads and persisted rows are admitted only through this fallback boundary. */
export function serverIconIdFromLegacy(iconId: unknown, emoji: unknown): ServerIconId {
  if (isServerIconId(iconId)) {
    return iconId;
  }
  if (typeof emoji === "string") {
    const legacy = emoji.trim();
    const option = serverIconOptions.find((candidate) =>
      candidate.legacyEmoji.some((candidateEmoji) => candidateEmoji === legacy),
    );
    if (option !== undefined) {
      return option.id;
    }
  }
  return DEFAULT_SERVER_ICON_ID;
}

/** Resolves presentation metadata after the icon id has crossed the validation boundary. */
export function serverIconOption(iconId: ServerIconId): ServerIconOption {
  return serverIconOptions.find((option) => option.id === iconId) ?? serverIconOptions[0];
}
