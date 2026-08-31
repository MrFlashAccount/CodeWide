/** @type {import("dependency-cruiser").IConfiguration} */
const config = {
  forbidden: [
    {
      name: "v2-no-circular-dependencies",
      severity: "error",
      comment: "V2 dependencies must remain acyclic.",
      from: {},
      to: { circular: true },
    },
    {
      name: "v2-no-unresolved-dependencies",
      severity: "error",
      comment: "Every V2 import must resolve through the V2 TypeScript configuration.",
      from: {},
      to: { couldNotResolve: true, path: "^(?!@codewide/)" },
    },
    {
      name: "v2-does-not-import-legacy",
      severity: "error",
      comment:
        "The V2 application cannot depend on the legacy Android implementation. The exact shared react/useEvent.ts callback primitive is runtime-neutral and required by the repository callback contract.",
      from: { path: "^src/v2/" },
      to: {
        path: "^src/(?!(?:boot|presentation|v2)(?:/|$)|react/useEvent[.]ts$|native/authenticated-transport-lease(?:[.]contract)?(?:[.](?:native|web))?(?:[.]ts)?$)",
      },
    },
    {
      name: "v2-routes-do-not-import-legacy",
      severity: "error",
      comment:
        "V2 routes compose V2 features and cannot reach into legacy Android source. The exact shared react/useEvent.ts callback primitive is runtime-neutral and required by the repository callback contract.",
      from: {
        path: "^app/(?!_layout[.]tsx$|index[.]tsx$|legacy[.]tsx$|pair[.]tsx$|thread[.]tsx$)",
      },
      to: { path: "^src/(?!(?:boot|v2)(?:/|$)|react/useEvent[.]ts$)" },
    },
    {
      name: "v2-domain-is-runtime-neutral",
      severity: "error",
      comment:
        "Domain code owns types and invariants and cannot depend on runtime or higher layers.",
      from: { path: "^src/v2/domain/" },
      to: {
        path: [
          "^app/",
          "^src/v2/(?:application|features|infrastructure|ui)/",
          "^node_modules/(?:expo(?:/|-)|react(?:/|$)|react-native(?:/|$))",
        ],
      },
    },
    {
      name: "v2-application-is-runtime-neutral",
      severity: "error",
      comment:
        "Application state machines depend on domain ports, not runtime adapters or presentation.",
      from: { path: "^src/v2/application/" },
      to: { path: "^(?:app/|src/v2/(?:features|infrastructure|ui)/)" },
    },
    {
      name: "v2-ui-is-presentation-only",
      severity: "error",
      comment:
        "Reusable V2 UI receives props and capabilities and cannot own application or I/O layers.",
      from: { path: "^src/v2/ui/" },
      to: { path: "^(?:app/|src/v2/(?:application|features|infrastructure)/)" },
    },
    {
      name: "shared-presentation-is-runtime-neutral",
      severity: "error",
      comment:
        "Shared presentation receives display props and capabilities and cannot depend on either application generation or I/O.",
      from: { path: "^src/presentation/" },
      to: {
        path: "^(?:app/|src/(?:boot|data|native|v2)/|node_modules/(?:@op-engineering/op-sqlite|expo-(?:crypto|file-system|linking|secure-store|sqlite))(?:/|$))",
      },
    },
    {
      name: "v2-infrastructure-does-not-depend-on-presentation",
      severity: "error",
      comment: "Infrastructure implements ports and cannot depend on routes, features, or UI.",
      from: { path: "^src/v2/infrastructure/" },
      to: { path: "^(?:app/|src/v2/(?:features|ui)/)" },
    },
    {
      name: "v2-capability-consumers-do-not-import-infrastructure",
      severity: "error",
      comment:
        "Routes, features, application code, and UI use injected ports instead of concrete adapters.",
      from: {
        path: "^(?:app/|src/v2/(?:application|features|ui)/)",
      },
      to: { path: "^src/v2/infrastructure/" },
    },
    {
      name: "v2-capability-consumers-do-not-import-native-io",
      severity: "error",
      comment: "Native I/O is owned by typed infrastructure adapters.",
      from: {
        path: "^(?:app/|src/v2/(?:application|features|ui)/)",
      },
      to: {
        path: "^node_modules/(?:@op-engineering/op-sqlite|expo-(?:crypto|file-system|linking|secure-store|sqlite))(?:/|$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      dependencyTypes: ["npm", "npm-bundled", "npm-dev", "npm-no-pkg", "npm-optional", "npm-peer"],
      path: "node_modules",
    },
    exclude: {
      path: "^(?:app/(?:_layout|index|legacy|pair|thread)[.]tsx)",
    },
    tsConfig: {
      fileName: "tsconfig.v2.json",
    },
  },
};

export default config;
