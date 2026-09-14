import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const android = fileURLToPath(new URL("../", import.meta.url));

describe("Android runtime type boundary", () => {
  it.each(["tsconfig.json", "tsconfig.v2.json"])(
    "%s rejects browser/Node APIs in the complete application graph",
    async (config) => {
      const directory = await mkdtemp(join(android, ".runtime-types-"));
      try {
        await writeFile(join(directory, "tsconfig.json"), JSON.stringify({
          extends: `../${config}`,
          files: ["../types/native-runtime.d.ts", "probe.ts"],
          compilerOptions: { noEmit: true, incremental: false },
        }));
        // Compile with all application imports: a dependency can accidentally
        // reintroduce DOM/Node globals even when compilerOptions.types is narrow.
        await writeFile(join(directory, "probe.ts"), `
export {};
const controller = new AbortController();
const cancelled: boolean = controller.signal.aborted;
controller.signal.addEventListener("abort", () => undefined);
const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode("profile");
const text: string = new TextDecoder().decode(bytes);
const time: number = performance.now();
queueMicrotask(() => undefined);
const id: string = crypto.randomUUID();
crypto.getRandomValues(bytes);
const headers: HeadersInit = { accept: "text/plain" };
void fetch("https://example.invalid", { signal: controller.signal, headers });
new DOMException("Cancelled", "AbortError");
void [cancelled, text, time, id];

controller.signal.throwIfAborted();
document.createElement("div");
Buffer.from("data");
crypto.subtle.digest("SHA-256", bytes);
`);
        const result = await new Promise<{ failed: boolean; output: string }>((resolve) => {
          execFile("pnpm", ["exec", "tsc", "--project", join(directory, "tsconfig.json"), "--pretty", "false"],
            { cwd: android, maxBuffer: 2 * 1024 * 1024, timeout: 60_000 },
            (error, stdout, stderr) => resolve({ failed: error !== null, output: stdout + stderr }));
        });
        expect(result.failed, result.output).toBe(true);
        const diagnostics = result.output.split("\n").filter((line) => /error TS\d+:/u.test(line));
        expect(diagnostics, result.output).toHaveLength(4);
        expect(diagnostics.every((line) => line.includes("probe.ts(")), result.output).toBe(true);
        for (const unsupported of ["throwIfAborted", "document", "Buffer", "subtle"]) {
          expect(diagnostics.some((line) => line.includes(`'${unsupported}'`)), result.output).toBe(true);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
