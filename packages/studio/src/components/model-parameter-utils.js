export function getModelParameterEntries(model, skipKeys = []) {
  const skip = new Set(["model", ...skipKeys]);
  return Object.entries(model?.inputs || {}).filter(([key, schema]) => {
    if (!schema || skip.has(key) || skip.has(schema.name) || skip.has(schema.field)) {
      return false;
    }
    return true;
  });
}

export function getDefaultInputValue(schema = {}) {
  if (schema.name === "aspect_ratio" && String(schema.default).toLowerCase() === "auto") {
    return Array.isArray(schema.enum)
      ? schema.enum.find((item) => String(item).toLowerCase() !== "auto") ?? "1:1"
      : "1:1";
  }
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === "boolean") return false;
  if (schema.type === "array") return [];
  if (schema.type === "int" || schema.type === "integer") {
    return schema.minValue ?? 0;
  }
  if (schema.type === "float" || schema.type === "number") {
    return schema.minValue ?? 0;
  }
  return "";
}

function clampNumber(schema = {}, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  let next = value;
  if (schema.minValue !== undefined) next = Math.max(schema.minValue, next);
  if (schema.maxValue !== undefined) next = Math.min(schema.maxValue, next);
  return next;
}

function isEnumValueAllowed(schema = {}, value) {
  if (!Array.isArray(schema.enum)) return true;
  if (schema.name === "aspect_ratio" && String(value).toLowerCase() === "auto") return false;
  return schema.enum.some((item) => String(item) === String(value));
}

export function createInitialModelParams(model, previousParams = {}, skipKeys = []) {
  return getModelParameterEntries(model, skipKeys).reduce((acc, [key, schema]) => {
    const previousValue = previousParams[key];
    if (previousValue !== undefined && isEnumValueAllowed(schema, previousValue)) {
      acc[key] = coerceModelParameterValue(schema, previousValue);
    } else {
      acc[key] = getDefaultInputValue(schema);
    }
    return acc;
  }, {});
}

export function coerceModelParameterValue(schema = {}, value) {
  if (schema.type === "boolean") return !!value;
  if (schema.type === "int" || schema.type === "integer") {
    if (value === "") return "";
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? clampNumber(schema, parsed) : "";
  }
  if (schema.type === "float" || schema.type === "number") {
    if (value === "") return "";
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? clampNumber(schema, parsed) : "";
  }
  if (schema.type === "array") {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function sanitizeValueForSchema(value, schema = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (schema.name === "aspect_ratio" && trimmed.toLowerCase() === "auto") return undefined;
    if (schema.type === "array") {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    const filtered = value.filter((item) => item !== undefined && item !== null && item !== "");
    return filtered.length > 0 ? filtered : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? clampNumber(schema, value) : undefined;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "object") {
    return Object.keys(value).length > 0 ? value : undefined;
  }
  return value;
}

export function sanitizeModelParams(params = {}, model = null, skipKeys = []) {
  const schemaByKey = model?.inputs || {};
  const skip = new Set(["model", ...skipKeys]);
  return Object.entries(params).reduce((acc, [key, value]) => {
    const schema = schemaByKey[key] || {};
    if (skip.has(key) || skip.has(schema.name) || skip.has(schema.field)) return acc;
    const sanitized = sanitizeValueForSchema(value, schema);
    if (sanitized !== undefined) acc[key] = sanitized;
    return acc;
  }, {});
}
