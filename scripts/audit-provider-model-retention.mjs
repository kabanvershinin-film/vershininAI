import {
  audioModels,
  i2iModels,
  i2vModels,
  lipsyncModels,
  t2iModels,
  t2vModels,
  v2vModels,
} from '../packages/studio/src/models.js';
import { loadProviderConfig } from '../packages/studio/src/providers/config.js';
import {
  buildStaticMemefastInventory,
  mergeModelInventory,
  summarizeInventory,
  assertNoModelRetentionLoss,
} from '../packages/studio/src/providers/model-inventory.js';
import {
  inferMemefastFamily,
  listMemefastRequestPlanEvidence,
} from '../packages/studio/src/providers/memefast/capabilities.js';
import { buildMemefastRequestPlan } from '../packages/studio/src/providers/memefast/request-plan.js';

const uiModelGroups = [
  ['t2i', 'image', t2iModels],
  ['i2i', 'image', i2iModels],
  ['t2v', 'video', t2vModels],
  ['i2v', 'video', i2vModels],
  ['v2v', 'video', v2vModels],
  ['lipsync', 'video', lipsyncModels],
  ['music', 'audio', audioModels],
];

const requestBodyIgnoredInputFields = new Set([
  'prompt',
  'api_key',
]);

const explicitlyUnsupportedExecutionModels = new Set([
  'audio:tts:minimax-voice-clone',
]);

const requestBodyFieldAliases = new Map([
  ['aspect_ratio', ['aspect_ratio', 'ratio', 'image_size', 'size']],
  ['audio', ['audio', 'generate_audio', 'generate_audio_switch']],
  ['audio_url', ['audio_url', 'audio', 'input_audio', 'audio_urls']],
  ['audios_list', ['audios_list', 'audio_urls', 'audios', 'audio_url']],
  ['duration', ['duration', 'seconds']],
  ['generate_audio', ['generate_audio', 'audio', 'generate_audio_switch']],
  ['image_url', ['image_url', 'image', 'images', 'image_urls', 'first_frame_image', 'img_url', 'promptImage', 'first_frame_img', 'file_infos', 'subjects', 'image_references', 'media']],
  ['images_list', ['images_list', 'image_urls', 'images', 'image_list', 'file_infos', 'subjects', 'image_references', 'media']],
  ['instrumental', ['instrumental', 'make_instrumental']],
  ['model', ['model', 'mv', 'preview_model', 'model_name', 'model_version']],
  ['name', ['name', 'effect_name', 'ref_name']],
  ['num_images', ['num_images', 'num_outputs', 'n']],
  ['quality', ['quality', 'mode', 'resolution']],
  ['render_speed', ['render_speed', 'rendering_speed']],
  ['request_id', ['request_id', 'requestId', 'req_id']],
  ['resolution', ['resolution', 'size', 'image_size', 'quality']],
  ['style', ['style', 'tags', 'style_type']],
  ['video_url', ['video_url', 'video', 'videos', 'media']],
  ['video_files', ['video_files', 'video_url', 'videos', 'media']],
]);

const expectedMoyinFamilies = [
  'image:gpt_image',
  'image:seedream',
  'image:kling_image',
  'image:flux',
  'image:flux_reference',
  'image:midjourney',
  'image:sdxl',
  'image:ideogram',
  'image:gemini_image',
  'image:fal_image',
  'image:qwen_image',
  'image:hunyuan_image',
  'image:wan_image',
  'image:vidu_image',
  'image:leonardo',
  'image:reve',
  'image:grok_image',
  'image:chroma',
  'image:recraft',
  'image:seededit',
  'image:z_image',
  'image:sora_image',
  'image:aigc_image',
  'image:dalle_image',
  'video:seedance',
  'video:omni_flash',
  'video:happyhorse',
  'video:kling',
  'video:grok',
  'video:sora',
  'video:veo',
  'video:wan',
  'video:vidu',
  'video:runway',
  'video:luma',
  'video:minimax',
  'video:pixverse',
  'text:text',
  'audio:suno',
  'audio:audio',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function audioOperationForModel(model) {
  return model.family === 'suno' || /^suno[-_]/i.test(model.id) ? 'music' : 'tts';
}

function sampleValueForInput(key, schema = {}) {
  if (schema.default !== undefined && schema.default !== null && schema.default !== '') return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (key === 'audios_list') return ['https://example.com/a.mp3', 'https://example.com/b.mp3'];
  if (key === 'images_list') return ['https://example.com/a.png', 'https://example.com/b.png'];
  if (key === 'video_files') return ['https://example.com/a.mp4'];
  if (key.includes('image')) return 'https://example.com/a.png';
  if (key.includes('video')) return 'https://example.com/a.mp4';
  if (key.includes('audio')) return 'https://example.com/a.mp3';
  if (schema.type === 'boolean') return true;
  if (schema.type === 'int' || schema.type === 'number') {
    return schema.minValue !== undefined ? Math.max(Number(schema.minValue), 1) : 1;
  }
  if (/^(width|height|num_|seed|guidance|strength|duration|speed|volume|pitch|sample_rate|bitrate|channel|accuracy|vocal_|style_weight|weirdness|audio_weight|continue_at|target_index|upscale_factor|rotate|move|vertical|opacity|scale|frames|weight)$/i.test(key)) {
    return 1;
  }
  if (/^(google_search|watermark|prompt_extend|go_fast|camera_fixed|bgm|sound|keep_original_sound|remove_watermark|thinking|multi_clip|custom_mode|instrumental|make_instrumental|sound_loop|grab_lyrics|english_normalization|need_noise_reduction|need_volume_normalization|prompt_optimizer|draft_mode)$/i.test(key)) {
    return true;
  }
  return `audit-${key}`;
}

function buildAuditInputs(model, fieldNames) {
  const inputs = {};
  for (const fieldName of fieldNames) {
    inputs[fieldName] = sampleValueForInput(fieldName, model.inputs?.[fieldName] || {});
  }
  inputs.prompt ||= 'audit prompt';
  inputs.image_url ||= 'https://example.com/a.png';
  inputs.video_url ||= 'https://example.com/a.mp4';
  inputs.audio_url ||= 'https://example.com/a.mp3';
  return inputs;
}

function requestBodyContainsField(body, fieldName) {
  const haystack = JSON.stringify(body);
  const aliases = requestBodyFieldAliases.get(fieldName) || [fieldName];
  return aliases.some((alias) => haystack.includes(`"${alias}"`));
}

function modelExecutionKey(mediaType, operation, modelId) {
  return `${mediaType}:${operation}:${modelId}`;
}

function assertArrayHasNoDuplicates(label, values) {
  const seen = new Set();
  const duplicates = [];
  for (const value of values || []) {
    if (seen.has(value)) duplicates.push(value);
    seen.add(value);
  }
  if (duplicates.length > 0) {
    fail(`${label} contains duplicate media references: ${duplicates.join(', ')}`);
  }
}

const config = loadProviderConfig();
if (config.selectedProviderId !== 'memefast') {
  fail(`Default provider must be memefast, got ${config.selectedProviderId}`);
}

let staticUiCount = 0;
const missingFamilies = [];
for (const [operation, mediaType, models] of uiModelGroups) {
  for (const model of models) {
    staticUiCount += 1;
    const family = inferMemefastFamily({ mediaType, modelId: model.id, operation });
    if (!family) missingFamilies.push(`${operation}:${model.id}`);
  }
}
if (staticUiCount !== 268) {
  fail(`Static UI model baseline changed unexpectedly: expected 268, got ${staticUiCount}`);
}
if (missingFamilies.length > 0) {
  fail(`MemeFast family mapping missing:\n${missingFamilies.join('\n')}`);
}

const staticRecords = buildStaticMemefastInventory();
if (staticRecords.length < 270) {
  fail(`Static MemeFast inventory lost records: expected at least 270, got ${staticRecords.length}`);
}

const snapshot = mergeModelInventory('memefast', staticRecords, {});
const summary = summarizeInventory(snapshot).memefast || { total: 0, byMediaType: {} };
if (summary.total < 267) {
  fail(`Static MemeFast inventory lost unique models: expected at least 267, got ${summary.total}`);
}
for (const [mediaType, minimum] of Object.entries({ image: 109, video: 140, audio: 12, text: 6 })) {
  const actual = summary.byMediaType?.[mediaType] || 0;
  if (actual < minimum) {
    fail(`Static MemeFast inventory lost ${mediaType} models: expected at least ${minimum}, got ${actual}`);
  }
}

const afterEmptyRemote = mergeModelInventory('memefast', staticRecords, snapshot);
assertNoModelRetentionLoss(summarizeInventory(snapshot), summarizeInventory(afterEmptyRemote));

const evidence = listMemefastRequestPlanEvidence();
const proven = new Set(evidence.provenFamilies);
const missingMoyinFamilies = expectedMoyinFamilies.filter((family) => !proven.has(family));
if (missingMoyinFamilies.length > 0) {
  fail(`MemeFast Moyin family coverage missing:\n${missingMoyinFamilies.join('\n')}`);
}

let frontendInputFieldCount = 0;
const missingRequestBodyFields = [];
const unsupportedRequestPlans = [];
for (const [groupOperation, mediaType, models] of uiModelGroups) {
  for (const model of models) {
    const fieldNames = Object.keys(model.inputs || {}).filter((fieldName) => !requestBodyIgnoredInputFields.has(fieldName));
    frontendInputFieldCount += fieldNames.length;
    if (fieldNames.length === 0) continue;

    const operation = mediaType === 'audio' ? audioOperationForModel(model) : groupOperation;
    let plan;
    try {
      plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType,
        operation,
        modelId: model.id,
        prompt: 'audit prompt',
        inputs: buildAuditInputs(model, fieldNames),
      });
    } catch (error) {
      const key = modelExecutionKey(mediaType, operation, model.id);
      if (explicitlyUnsupportedExecutionModels.has(key) && error.code === 'unsupported_request_plan') {
        continue;
      }
      unsupportedRequestPlans.push(`${operation}:${model.id}:${error.message}`);
      continue;
    }

    for (const fieldName of fieldNames) {
      if (!requestBodyContainsField(plan.body, fieldName)) {
        missingRequestBodyFields.push(`${operation}:${model.id}:${fieldName}:${plan.family}`);
      }
    }
  }
}
if (unsupportedRequestPlans.length > 0) {
  fail(`MemeFast request-plan build failed for frontend models:\n${unsupportedRequestPlans.join('\n')}`);
}
if (missingRequestBodyFields.length > 0) {
  fail(`MemeFast request body does not retain frontend model inputs:\n${missingRequestBodyFields.join('\n')}`);
}

const duplicateAliasImagePlan = buildMemefastRequestPlan({
  selectedProviderId: 'memefast',
  mediaType: 'image',
  operation: 'i2i',
  modelId: 'nano-banana-edit',
  prompt: 'audit prompt',
  inputs: {
    image_url: 'https://example.com/a.png',
    imageUrl: 'https://example.com/a.png',
  },
});
assertArrayHasNoDuplicates('image image_urls', duplicateAliasImagePlan.body.image_urls || []);

const duplicateAliasSeedancePlan = buildMemefastRequestPlan({
  selectedProviderId: 'memefast',
  mediaType: 'video',
  operation: 'i2v',
  modelId: 'doubao-seedance-1-0-pro-250528',
  prompt: 'audit prompt',
  inputs: {
    image_url: 'https://example.com/a.png',
    imageUrl: 'https://example.com/a.png',
    firstFrame: 'https://example.com/a.png',
    last_image: 'https://example.com/b.png',
    lastFrame: 'https://example.com/b.png',
  },
});
const seedanceImageUrls = duplicateAliasSeedancePlan.body.content
  .filter((item) => item.type === 'image_url')
  .map((item) => item.image_url.url);
assertArrayHasNoDuplicates('seedance content image_url', seedanceImageUrls);
if (JSON.stringify(seedanceImageUrls) !== JSON.stringify(['https://example.com/a.png', 'https://example.com/b.png'])) {
  fail(`Seedance first/last image references changed unexpectedly: ${JSON.stringify(seedanceImageUrls)}`);
}

try {
  buildMemefastRequestPlan({
    selectedProviderId: 'memefast',
    mediaType: 'audio',
    operation: 'tts',
    modelId: 'minimax-voice-clone',
    prompt: 'audit prompt',
    inputs: {
      audio_url: 'https://example.com/a.wav',
      custom_voice_id: 'auditVoice1',
      model: 'speech-2.6-hd',
    },
  });
  fail('minimax-voice-clone must not route through the generic TTS endpoint without a verified MemeFast voice clone adapter.');
} catch (error) {
  if (error.code !== 'unsupported_request_plan') throw error;
}

console.log(JSON.stringify({
  ok: true,
  staticUiCount,
  staticMemefastRecords: staticRecords.length,
  staticMemefastUniqueModels: summary.total,
  byMediaType: summary.byMediaType,
  moyinFamilyCount: expectedMoyinFamilies.length,
  frontendInputFieldCount,
  explicitlyUnsupportedExecutionModels: Array.from(explicitlyUnsupportedExecutionModels),
  requestBodyIgnoredInputFields: Array.from(requestBodyIgnoredInputFields),
}, null, 2));
