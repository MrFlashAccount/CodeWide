// Metro selects `.native` on Android and `.web` in the browser. This fallback
// keeps platform-neutral tooling and unit tests resolvable without changing
// either runtime bundle.
export * from "./native-transport.web";
