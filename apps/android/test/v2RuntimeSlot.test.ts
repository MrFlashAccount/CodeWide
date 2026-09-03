import { afterEach, describe, expect, it } from "vitest";

import {
  activateRuntime,
  activeRuntimeGeneration,
  stopRuntime,
  type ApplicationRuntimeHandle,
} from "../src/boot/runtimeSlot";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

afterEach(async () => {
  await stopRuntime("legacy");
  await stopRuntime("v2");
});

describe("UI generation runtime slot", () => {
  it("finishes stopping the old runtime before creating and starting the new runtime", async () => {
    const events: string[] = [];
    const stopped = deferred();
    const legacy: ApplicationRuntimeHandle = {
      start: () => {
        events.push("legacy:start");
      },
      stop: async () => {
        events.push("legacy:stop:start");
        await stopped.promise;
        events.push("legacy:stop:end");
      },
    };
    await activateRuntime("legacy", () => legacy);

    const activation = activateRuntime("v2", () => ({
      start: () => {
        events.push("v2:start");
      },
      stop: () => {
        events.push("v2:stop");
      },
    }));
    await Promise.resolve();

    expect(events).toStrictEqual(["legacy:start", "legacy:stop:start"]);
    expect(activeRuntimeGeneration()).toBe("legacy");
    stopped.resolve();
    await activation;
    expect(events).toStrictEqual([
      "legacy:start",
      "legacy:stop:start",
      "legacy:stop:end",
      "v2:start",
    ]);
    expect(activeRuntimeGeneration()).toBe("v2");
  });

  it("serializes an activation behind an explicit asynchronous stop", async () => {
    const stopped = deferred();
    await activateRuntime("legacy", () => ({ stop: async () => stopped.promise }));

    const stop = stopRuntime("legacy");
    const activation = activateRuntime("v2", () => ({ stop: () => undefined }));
    await Promise.resolve();
    expect(activeRuntimeGeneration()).toBe("legacy");

    stopped.resolve();
    await stop;
    await activation;
    expect(activeRuntimeGeneration()).toBe("v2");
  });

  it("clears and disposes a runtime whose start fails", async () => {
    let stopped = false;
    await expect(
      activateRuntime("v2", () => ({
        start: () => {
          throw new Error("start failed");
        },
        stop: () => {
          stopped = true;
        },
      })),
    ).rejects.toThrow("start failed");
    expect(stopped).toBe(true);
    expect(activeRuntimeGeneration()).toBeNull();
  });
});
