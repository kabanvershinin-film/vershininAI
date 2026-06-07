"use client";

import {
  coerceModelParameterValue,
  createInitialModelParams,
  getModelParameterEntries,
  sanitizeModelParams,
} from "./model-parameter-utils.js";

export {
  createInitialModelParams,
  sanitizeModelParams,
};

function formatParamName(key, schema) {
  return schema?.title || schema?.name || key.replace(/_/g, " ");
}

function getInputValue(params, key, schema) {
  if (params[key] !== undefined) return params[key];
  return "";
}

function updateParam(params, key, schema, rawValue) {
  return {
    ...params,
    [key]: coerceModelParameterValue(schema, rawValue),
  };
}

function BooleanControl({ keyName, schema, value, onChange }) {
  const enabled = !!value;
  return (
    <button
      type="button"
      title={schema.description || formatParamName(keyName, schema)}
      onClick={() => onChange(!enabled)}
      className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-all ${
        enabled
          ? "bg-[#22d3ee]/15 border-[#22d3ee]/40 text-[#22d3ee]"
          : "bg-white/[0.03] border-white/[0.05] text-white/45 hover:text-white/80"
      }`}
    >
      <span className="text-[11px] font-semibold whitespace-nowrap">
        {formatParamName(keyName, schema)}
      </span>
      <span
        className={`w-8 h-4 rounded-full p-0.5 transition-all ${
          enabled ? "bg-[#22d3ee]" : "bg-white/10"
        }`}
      >
        <span
          className={`block w-3 h-3 rounded-full bg-black transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function EnumControl({ keyName, schema, value, onChange }) {
  return (
    <label
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.05]"
      title={schema.description || formatParamName(keyName, schema)}
    >
      <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap">
        {formatParamName(keyName, schema)}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[11px] text-white/80 focus:outline-none min-w-[84px] max-w-[170px]"
      >
        {(schema.enum || []).map((option) => (
          <option key={String(option)} value={option} className="bg-[#111] text-white">
            {String(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberControl({ keyName, schema, value, onChange }) {
  const step = schema.step || (schema.type === "float" || schema.type === "number" ? 0.05 : 1);
  const hasRange = schema.minValue !== undefined && schema.maxValue !== undefined;
  const current = value === "" || value === undefined ? "" : value;
  return (
    <label
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.05]"
      title={schema.description || formatParamName(keyName, schema)}
    >
      <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap">
        {formatParamName(keyName, schema)}
      </span>
      {hasRange && (
        <input
          type="range"
          min={schema.minValue}
          max={schema.maxValue}
          step={step}
          value={current === "" ? schema.minValue : current}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 accent-[#22d3ee]"
        />
      )}
      <input
        type="number"
        min={schema.minValue}
        max={schema.maxValue}
        step={step}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white/80 focus:outline-none focus:border-[#22d3ee]/60"
      />
    </label>
  );
}

function TextControl({ keyName, schema, value, onChange }) {
  const isArray = schema.type === "array";
  const displayValue =
    isArray && Array.isArray(value)
      ? JSON.stringify(value)
      : value ?? "";
  return (
    <label
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.05]"
      title={schema.description || formatParamName(keyName, schema)}
    >
      <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap">
        {formatParamName(keyName, schema)}
      </span>
      <input
        type="text"
        value={displayValue}
        placeholder={schema.placeholder || (isArray ? "JSON array" : "")}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[120px] max-w-[240px] bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#22d3ee]/60"
      />
    </label>
  );
}

export default function ModelParameterControls({
  model,
  params,
  onChange,
  skipKeys = [],
  className = "",
}) {
  const entries = getModelParameterEntries(model, skipKeys);
  if (entries.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {entries.map(([key, schema]) => {
        const value = getInputValue(params, key, schema);
        const setValue = (rawValue) => {
          onChange(updateParam(params, key, schema, rawValue));
        };

        if (schema.type === "boolean") {
          return (
            <BooleanControl
              key={key}
              keyName={key}
              schema={schema}
              value={value}
              onChange={setValue}
            />
          );
        }

        if (Array.isArray(schema.enum)) {
          return (
            <EnumControl
              key={key}
              keyName={key}
              schema={schema}
              value={value}
              onChange={setValue}
            />
          );
        }

        if (
          schema.type === "int" ||
          schema.type === "integer" ||
          schema.type === "float" ||
          schema.type === "number"
        ) {
          return (
            <NumberControl
              key={key}
              keyName={key}
              schema={schema}
              value={value}
              onChange={setValue}
            />
          );
        }

        return (
          <TextControl
            key={key}
            keyName={key}
            schema={schema}
            value={value}
            onChange={setValue}
          />
        );
      })}
    </div>
  );
}
