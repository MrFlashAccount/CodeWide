export type ElicitationField = {
  id: string;
  label: string;
  description: string | null;
  type: string;
  required: boolean;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
};

export function mcpElicitationFields(params: Record<string, unknown>): ElicitationField[] {
  const schema = asRecord(params.requestedSchema);
  const properties = asRecord(schema?.properties);
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
  if (properties === null) return [];
  return Object.entries(properties).flatMap(([id, rawSchema]) => {
    const field = asRecord(rawSchema);
    if (field === null || typeof field.type !== "string") return [];
    const options = elicitationOptions(field);
    const defaultValue = Array.isArray(field.default)
      ? field.default.filter((value): value is string => typeof value === "string").join(", ")
      : field.default === undefined ? "" : String(field.default);
    return [{
      id,
      label: typeof field.title === "string" ? field.title : id,
      description: typeof field.description === "string" ? field.description : null,
      type: field.type,
      required: required.has(id),
      defaultValue,
      options,
    }];
  });
}

export function parseElicitationValue(type: string, raw: string): unknown {
  if (type === "number" || type === "integer") {
    const value = Number(raw);
    if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) throw new Error(`Expected ${type}`);
    return value;
  }
  if (type === "boolean") return raw === "true";
  if (type === "array") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return raw;
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function elicitationOptions(schema: Record<string, unknown>): Array<{ value: string; label: string }> {
  if (schema.type === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.flatMap((value, index) => typeof value === "string"
      ? [{ value, label: typeof names[index] === "string" ? names[index] : value }]
      : []);
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.flatMap((option) => {
      const object = asRecord(option);
      return object !== null && typeof object.const === "string"
        ? [{ value: object.const, label: typeof object.title === "string" ? object.title : object.const }]
        : [];
    });
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
