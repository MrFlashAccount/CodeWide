import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerSuggestions } from "../src/features/composer/input/composer-suggestions";
import type { ComposerMention } from "../src/features/composer/input/composer-mentions";

const item: ComposerMention = { kind: "skill", id: "skill", label: "Skill", insertText: "$skill", name: "skill", path: "/skills/skill", url: "codewide-skill://%2Fskills%2Fskill", description: "", group: "", plugin: null };

describe("composer suggestion search lifetime", () => {
  afterEach(() => vi.useRealTimers());

  it("does not restart a ready search when the caret reports the same query", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [item]);
    const model = new ComposerSuggestions();
    const query = { indicator: "/", text: "skill" } as const;
    model.search(query, search);
    await vi.runAllTimersAsync();
    const ready = model.state$.peek().value;
    model.search(query, search);
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledTimes(1);
    expect(model.state$.peek().value).toBe(ready);
  });

  it("retains visible suggestions during the next query without a closed flash", async () => {
    vi.useFakeTimers();
    const model = new ComposerSuggestions();
    model.search({ indicator: "/", text: "s" }, async () => [item]);
    await vi.runAllTimersAsync();
    const pending = Promise.withResolvers<readonly ComposerMention[]>();
    model.search({ indicator: "/", text: "sk" }, () => pending.promise);
    expect(model.state$.get().value).toEqual({ status: "loading", query: { indicator: "/", text: "sk" }, items: [item] });
    await vi.runAllTimersAsync();
    model.search({ indicator: "@", text: "" }, async () => []);
    expect(model.state$.get().value).toEqual({ status: "loading", query: { indicator: "@", text: "" }, items: [] });
    pending.resolve([item]);
    await vi.runAllTimersAsync();
    expect(model.state$.get().value).toEqual({ status: "ready", query: { indicator: "@", text: "" }, items: [] });
  });

  it("publishes the latest query even if an earlier search finishes afterwards", async () => {
    vi.useFakeTimers();
    const older = Promise.withResolvers<readonly ComposerMention[]>();
    const model = new ComposerSuggestions();
    model.search({ indicator: "/", text: "old" }, () => older.promise);
    await vi.runAllTimersAsync();
    model.search({ indicator: "/", text: "new" }, async () => [item]);
    await vi.runAllTimersAsync();
    older.resolve([]);
    await older.promise;
    expect(model.state$.get().value).toEqual({ status: "ready", query: { indicator: "/", text: "new" }, items: [item] });
  });

  it("does not reopen after selection, dismissal, or input unmount", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<readonly ComposerMention[]>();
    const model = new ComposerSuggestions();
    model.search({ indicator: "@", text: "" }, () => pending.promise);
    await vi.runAllTimersAsync();
    model.close();
    pending.resolve([item]);
    await pending.promise;
    expect(model.state$.get().value).toEqual({ status: "closed" });
  });

  it("cancels superseded scheduled searches and allows recovery after an error", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [item]);
    const model = new ComposerSuggestions();
    model.search({ indicator: "/", text: "s" }, search);
    model.search({ indicator: "/", text: "sk" }, search);
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ indicator: "/", text: "sk" });
    model.search({ indicator: "@", text: "failed" }, async () => { throw new Error("unavailable"); });
    await vi.runAllTimersAsync();
    expect(model.state$.get().value.status).toBe("error");
    model.search({ indicator: "/", text: "sk" }, search);
    await vi.runAllTimersAsync();
    expect(model.state$.get().value.status).toBe("ready");
  });
});
