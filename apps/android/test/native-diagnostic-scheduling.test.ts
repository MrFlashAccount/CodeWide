import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const journal = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/diagnostics/DiagnosticJournal.kt",
    import.meta.url,
  ),
  "utf8",
);
const uploader = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/NativeDiagnosticUploader.kt",
    import.meta.url,
  ),
  "utf8",
);

it("keeps an empty diagnostic outbox event-driven and backs off retained reports", () => {
  expect(journal).toContain("fun hasPending(): Boolean");
  expect(uploader).toContain("if (!journal.hasPending()) return");
  expect(uploader).toContain("retryNeeded = journal.hasPending()");
  expect(uploader).toContain("retryNeeded || requested");
  expect(uploader).toContain("if (requested) 0L else retryDelaySeconds");
  expect(uploader).toContain("coerceAtMost(RETRY_MAX_DELAY_SECONDS)");
  expect(uploader).toContain("const val RETRY_MAX_DELAY_SECONDS = 15 * 60L");
  expect(uploader).not.toContain(
    "if (!closed) scheduled = executor.schedule(::drain, 30, TimeUnit.SECONDS)",
  );
});
