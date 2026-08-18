import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearGlobalError,
  getGlobalErrorSnapshot,
  reportGlobalError,
  subscribeGlobalError,
} from "../src/ui/global-error-store";

describe("global error store", () => {
  beforeEach(() => clearGlobalError());

  it("publishes a normalized fatal error and clears it for recovery", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGlobalError(listener);

    reportGlobalError("root failed", "manual", true);

    expect(getGlobalErrorSnapshot()).toMatchObject({
      error: expect.objectContaining({ message: "root failed" }),
      isFatal: true,
      source: "manual",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    clearGlobalError();
    expect(getGlobalErrorSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
