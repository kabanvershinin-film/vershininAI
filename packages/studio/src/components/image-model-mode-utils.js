export const IMAGE_MODEL_MODE_PAIRS = Object.freeze([
  { t2i: "nano-banana-2", i2i: "nano-banana-2-edit" },
  { t2i: "seedream-5.0", i2i: "seedream-5.0-edit" },
  { t2i: "gpt-image-2", i2i: "gpt-image-2-edit" },
  { t2i: "gpt-image-2-all", i2i: "gpt-image-2-all-edit" },
]);

const findModelById = (models, modelId) => models.find((model) => model.id === modelId);

export function resolveI2IModelForUpload(selectedModelId, i2iModels) {
  const pair = IMAGE_MODEL_MODE_PAIRS.find((item) => item.t2i === selectedModelId);
  if (pair) return findModelById(i2iModels, pair.i2i) || null;
  return null;
}

export function resolveT2IModelForClear(selectedModelId, t2iModels) {
  const pair = IMAGE_MODEL_MODE_PAIRS.find((item) => item.i2i === selectedModelId);
  if (pair) return findModelById(t2iModels, pair.t2i) || null;
  return null;
}
