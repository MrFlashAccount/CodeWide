import { render as renderNative } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import type { SidebarProject } from "../src/features/projects/sidebarProjects";

export const project: SidebarProject = {
  key: "server:/repo",
  connectionId: "server",
  path: "/repo",
  name: "Repo",
  serverLabel: null,
  subtitle: "/repo",
  pinned: true,
  lastUsedAt: 1,
  unread: true,
};

export const management = {
  servers: [{ id: "server", name: "Buddy" }],
  onMove: jest.fn(async () => undefined),
  onBrowse: jest.fn(),
};

function TestProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function render(element: ReactElement) {
  return renderNative(element, { wrapper: TestProvider });
}
