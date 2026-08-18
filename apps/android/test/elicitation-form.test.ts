import { describe, expect, it } from "vitest";

import { isSafeHttpUrl, mcpElicitationFields, parseElicitationValue } from "../src/data/elicitation-form.js";

describe("MCP elicitation forms", () => {
  it("maps typed fields, required values, defaults and enum labels", () => {
    expect(mcpElicitationFields({
      requestedSchema: {
        type: "object",
        required: ["environment"],
        properties: {
          environment: { type: "string", title: "Environment", enum: ["dev", "prod"], enumNames: ["Development", "Production"] },
          replicas: { type: "integer", default: 2 },
          confirm: { type: "boolean", default: false },
        },
      },
    })).toMatchObject([
      { id: "environment", required: true, options: [{ value: "dev", label: "Development" }, { value: "prod", label: "Production" }] },
      { id: "replicas", type: "integer", defaultValue: "2" },
      { id: "confirm", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
    ]);
  });

  it("parses primitive content and rejects invalid numeric input", () => {
    expect(parseElicitationValue("integer", "3")).toBe(3);
    expect(parseElicitationValue("boolean", "true")).toBe(true);
    expect(parseElicitationValue("array", "alpha, beta")).toEqual(["alpha", "beta"]);
    expect(() => parseElicitationValue("integer", "3.5")).toThrow("Expected integer");
  });

  it("allows only HTTP(S) URL-mode targets", () => {
    expect(isSafeHttpUrl("https://example.test/form")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///data/private")).toBe(false);
  });
});
