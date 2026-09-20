import { defineHygieneConfig } from "@sergeigarin/hygene";
import { globSync, readFileSync } from "node:fs";

const base = defineHygieneConfig({
  environment: "universal",
  typeCheck: true,
});
const [, baseRestrictedImports] = base.rules["no-restricted-imports"];
const reactDoctorRules = Object.fromEntries(
  Object.entries(base.rules).filter(([rule]) => rule.startsWith("react-doctor/")),
);
const disabledReactDoctorRules = Object.fromEntries(
  Object.keys(reactDoctorRules).map((rule) => [rule, "off"]),
);
const reactHookTypeScriptFiles = globSync(["app/v1/**/*.ts", "src/**/*.ts"], {
  cwd: import.meta.dirname,
})
  .filter(
    (file) =>
      !file.startsWith("src/boot/") &&
      !file.startsWith("src/presentation/") &&
      !file.startsWith("src/v2/"),
  )
  .filter((file) =>
    /\buse[A-Z][A-Za-z0-9_]*\s*\(/u.test(readFileSync(new URL(file, import.meta.url), "utf8")),
  );
const v1OwnedFiles = [
  "app/legacy.tsx",
  "app/v1/**/*.ts",
  "app/v1/**/*.tsx",
  "src/**/*.ts",
  "src/**/*.tsx",
];

/** Full shared hygiene policy scoped to the V1 Android implementation. */
export default {
  ...base,
  globals: {
    EventSource: "readonly",
    WebSocket: "readonly",
    fetch: "readonly",
    indexedDB: "readonly",
    localStorage: "readonly",
    sessionStorage: "readonly",
  },
  ignorePatterns: [
    ".expo/**",
    "android/**",
    "assets/**",
    "coverage/**",
    "dist/**",
    "node_modules/**",
    "src/boot/**",
    "src/presentation/**",
    "src/v2/**",
  ],
  jsPlugins: [
    ...base.jsPlugins,
    { name: "codewide-v1", specifier: "./oxlint-v1-quality.cjs" },
    { name: "codewide-presentation", specifier: "./oxlint-presentation-tokens.cjs" },
  ],
  rules: {
    ...base.rules,
    "codewide-v1/imports-separated-from-code": "error",
    "codewide-v1/no-manual-react-memoization": "error",
    "codewide-v1/require-public-export-jsdoc": "error",
    "codewide-v1/stylesheet-properties-multiline": "error",
    "no-restricted-imports": [
      "error",
      {
        ...baseRestrictedImports,
        paths: [
          ...baseRestrictedImports.paths,
          {
            importNames: ["useCallback", "useMemo"],
            message:
              "React Compiler owns render memoization. Use useEvent only for retained callbacks and an explicit state/ref/model owner for stateful identities.",
            name: "react",
          },
        ],
      },
    ],
  },
  overrides: [
    ...base.overrides,
    {
      files: [
        "src/CodeWideScreen.tsx",
        "src/features/**/*.ts",
        "src/features/**/*.tsx",
        "src/rendering/**/*.ts",
        "src/rendering/**/*.tsx",
        "src/ui/**/*.ts",
        "src/ui/**/*.tsx",
      ],
      rules: { "codewide-presentation/presentation-tokens": "error" },
    },
    {
      files: ["app/v1/**/*.ts", "src/**/*.ts"],
      rules: disabledReactDoctorRules,
    },
    {
      files: reactHookTypeScriptFiles,
      rules: reactDoctorRules,
    },
    {
      files: v1OwnedFiles,
      rules: {
        "react-doctor/context-provider-value-from-unmemoized-local-literal": "off",
        "react-doctor/jsx-no-constructed-context-values": "off",
        "react-doctor/jsx-no-new-array-as-prop": "off",
        "react-doctor/jsx-no-new-function-as-prop": "off",
        "react-doctor/jsx-no-new-object-as-prop": "off",
      },
    },
  ],
};
