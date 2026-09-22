import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CODEX_PROTOCOL_VERSION } from "../packages/codex-protocol/src/index.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedVersion = `codex-cli ${CODEX_PROTOCOL_VERSION}`;
const actualVersion = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();

if (actualVersion !== expectedVersion) {
  throw new Error(
    `Protocol generation requires ${expectedVersion}; found ${actualVersion}. Update the CLI or explicitly migrate the protocol version first.`,
  );
}

for (const [command, output] of [
  ["generate-ts", `packages/codex-protocol/src/generated/${CODEX_PROTOCOL_VERSION}`],
  ["generate-json-schema", `packages/codex-protocol/schema/${CODEX_PROTOCOL_VERSION}`],
] as const) {
  execFileSync("codex", ["app-server", command, "--experimental", "--out", output], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}
