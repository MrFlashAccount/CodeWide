import { describe, expect, it } from "vitest";
import type { V2PendingRequest } from "@codewide/sync-client/v2";

import {
  pendingRequestResolution,
  pendingRequestViewModel,
} from "../src/v2/features/requests/pendingRequestAdapter.js";

describe("V2 pending request adapter", () => {
  it("preserves form defaults and labeled choices in the presentation model", () => {
    const request = elicitationRequest();
    const model = pendingRequestViewModel(request);

    expect(model.kind).toBe("elicitation");
    if (model.kind !== "elicitation") throw new Error("Expected elicitation view model");
    expect(model.fields[0]).toMatchObject({
      defaultValue: { kind: "value", value: "prod" },
      options: [
        { label: "Development", value: "dev" },
        { label: "Production", value: "prod" },
      ],
      required: true,
      type: "select",
    });
    expect(model.fields[1]).toMatchObject({
      defaultValue: { kind: "unset" },
      required: false,
      type: "text",
    });
  });

  it("serializes typed values without manufacturing absent optional fields", () => {
    const request = elicitationRequest();

    expect(
      pendingRequestResolution(request, {
        action: "accept",
        kind: "elicitation",
        values: [
          { fieldId: "environment", value: "prod" },
          { fieldId: "targets", value: ["api", "worker"] },
          { fieldId: "nullable", value: null },
        ],
      }),
    ).toEqual({
      action: "accept",
      contentJson: JSON.stringify({
        environment: "prod",
        targets: ["api", "worker"],
        nullable: null,
      }),
      kind: "elicitation",
      metadataJson: null,
    });
  });
});

function elicitationRequest(): V2PendingRequest {
  return {
    fields: [
      {
        defaultValue: { kind: "value", value: "prod" },
        description: null,
        id: "environment",
        label: "Environment",
        options: [
          { label: "Development", value: "dev" },
          { label: "Production", value: "prod" },
        ],
        required: true,
        type: "select",
      },
      {
        defaultValue: { kind: "unset" },
        description: null,
        id: "note",
        label: "Optional note",
        options: null,
        required: false,
        type: "text",
      },
      {
        defaultValue: { kind: "unset" },
        description: null,
        id: "targets",
        label: "Targets",
        options: null,
        required: false,
        type: "array",
      },
      {
        defaultValue: { kind: "value", value: null },
        description: null,
        id: "nullable",
        label: "Nullable",
        options: null,
        required: false,
        type: "text",
      },
    ],
    generation: "4",
    id: "elicitation",
    elicitationId: null,
    kind: "elicitation",
    message: "Configure the tool",
    metadataJson: null,
    mode: "form",
    requestedSchemaJson: null,
    serverName: "Example MCP",
    threadId: "thread",
    turnId: "turn",
    url: null,
  };
}
