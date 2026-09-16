import { unknownRecord } from "../../data/unknownRecord";

export type ElicitationField = {
  defaultValue: string;
  description: string | null;
  id: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  required: boolean;
  type: string;
};

export function mcpElicitationFields(params: Record<string, unknown>): ElicitationField[] {
  const schema = asRecord(params.requestedSchema);
  const properties = asRecord(schema?.properties);
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  if (properties === null) {
    return [];
  }
  return Object.entries(properties).flatMap(([id, rawSchema]) => {
    const field = asRecord(rawSchema);
    if (field === null || typeof field.type !== "string") {
      return [];
    }
    const options = elicitationOptions(field);
    const defaultValue = Array.isArray(field.default)
      ? field.default.filter((value): value is string => typeof value === "string").join(", ")
      : field.default === undefined
        ? ""
        : primitiveDefaultValue(field.default);
    return [
      {
        defaultValue,
        description: typeof field.description === "string" ? field.description : null,
        id,
        label: typeof field.title === "string" ? field.title : id,
        options,
        required: required.has(id),
        type: field.type,
      },
    ];
  });
}

function primitiveDefaultValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

export function parseElicitationValue(type: string, raw: string): unknown {
  if (type === "number" || type === "integer") {
    const value = Number(raw);
    if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      throw new Error(`Expected ${type}`);
    }
    return value;
  }
  if (type === "boolean") {
    return raw === "true";
  }
  if (type === "array") {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return raw;
}

function elicitationOptions(
  schema: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  if (schema.type === "boolean") {
    return [
      { label: "Yes", value: "true" },
      { label: "No", value: "false" },
    ];
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.flatMap((value, index) =>
      typeof value === "string"
        ? [{ label: typeof names[index] === "string" ? names[index] : value, value }]
        : [],
    );
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.flatMap((option) => {
      const object = asRecord(option);
      return object !== null && typeof object.const === "string"
        ? [
            {
              label: typeof object.title === "string" ? object.title : object.const,
              value: object.const,
            },
          ]
        : [];
    });
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}
