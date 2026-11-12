/**
 * Current stop of each guide walk, keyed by diff source on one connection.
 * Interaction state only; progress itself is companion-owned.
 */
import { observable } from "@legendapp/state";

/** Selected stop index by `connectionId\0sourceKey`; absent resumes at the first open stop. */
export const guideWalkModel = observable<Record<string, number>>({});
