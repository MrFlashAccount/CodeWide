import { createContext } from "react";

/** A chat delegates HTTPS navigation to the surrounding workspace after local-file and port handling. */
export const OpenForgeLinkContext = createContext<
  ((href: string, connectionId: string | null) => boolean) | null
>(null);
