import type { ReviewRouteScope } from "../navigation/routeDestinations";
import {
  opaqueRouteParam,
  qualifiedThreadRouteParams,
  type RawRouteParam,
  type ThreadRouteParams,
} from "../navigation/routeParams";
import type { QualifiedThread } from "../../domain/qualifiedThread";

export interface RawReviewRouteParams extends ThreadRouteParams {
  itemId?: RawRouteParam;
  mode?: RawRouteParam;
  scope?: RawRouteParam;
  turnId?: RawRouteParam;
}

export type ReviewRoute =
  | { mode: "start"; owner: QualifiedThread }
  | { mode: "changes"; owner: QualifiedThread; scope: ReviewRouteScope }
  | { itemId: string; mode: "response"; owner: QualifiedThread; turnId: string };

export function reviewRoute(params: RawReviewRouteParams): ReviewRoute | null {
  const owner = qualifiedThreadRouteParams(params);
  if (owner === null || typeof params.mode !== "string") return null;
  if (params.mode === "start") return exactStartRoute(params) ? { mode: "start", owner } : null;
  if (params.mode === "changes") {
    if (params.turnId !== undefined || params.itemId !== undefined) return null;
    const scope = optionalReviewScope(params.scope);
    return scope === null ? null : { mode: "changes", owner, scope };
  }
  if (params.mode !== "response" || params.scope !== undefined) return null;
  const turnId = opaqueRouteParam(params.turnId);
  const itemId = opaqueRouteParam(params.itemId);
  return turnId === null || itemId === null ? null : { itemId, mode: "response", owner, turnId };
}

function exactStartRoute(params: RawReviewRouteParams): boolean {
  return params.scope === undefined && params.turnId === undefined && params.itemId === undefined;
}

function optionalReviewScope(value: RawRouteParam): ReviewRouteScope | null {
  if (value === undefined) return "session";
  if (typeof value !== "string") return null;
  if (
    value === "branch" ||
    value === "lastTurn" ||
    value === "session" ||
    value === "staged" ||
    value === "unstaged"
  )
    return value;
  return null;
}
