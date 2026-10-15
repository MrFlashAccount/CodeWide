/**
 * The app's one remote project catalog. Every project list reads it, and the
 * sync stream merges `companion/project/changed` into it, so a pin change made
 * on another device reaches the lists without their next read.
 */
import { createRemoteProjectCatalogModel } from "./remote-project-catalog-model";
import { remoteProjectCatalogCache } from "./remoteProjectCatalogCache";

export const remoteProjectCatalogModel = createRemoteProjectCatalogModel({
  cache: remoteProjectCatalogCache,
});
