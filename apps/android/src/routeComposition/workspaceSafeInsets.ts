import { createContext } from "react";

/** No system space remains to reserve inside an already inset surface. */
export const consumedWorkspaceInsets: { readonly bottom: number; readonly top: number } = {
  bottom: 0,
  top: 0,
};

/** Space still to reserve for system controls and the optional diagnostics row. */
export const WorkspaceSafeInsetsContext = createContext(consumedWorkspaceInsets);
