// Metro selects `.native` on Android and `.web` in the browser. Tooling and
// platform-neutral tests use the web fallback without loading native SQLite.
export { remoteProjectCatalogCache } from "./remoteProjectCatalogCache.web";
