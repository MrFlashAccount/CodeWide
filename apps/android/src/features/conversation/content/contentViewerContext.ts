/** V1 contentViewerContext owner, extracted without changing interaction or resource lifetime. */
import { createContext } from "react";
import type { LargeContentRouteRequest } from "../../../services/content/contentRouteSession";

export type LargeContentViewerRequest = LargeContentRouteRequest;

export const LargeContentViewerContext = createContext<
  ((request: LargeContentViewerRequest) => void) | null
>(null);
