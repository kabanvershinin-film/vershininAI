import { ProviderLayerError } from '../errors.js';

function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueNonEmpty(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const normalized = typeof value === 'string' ? value.trim() : value;
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function readNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function readBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    }
    return undefined;
}

function normalizeString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function appendDefined(object, key, value) {
    if (value !== undefined && value !== null && value !== '') object[key] = value;
}

function appendDefinedIfMissing(object, key, value) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return;
    appendDefined(object, key, value);
}

function aspectRatioFromInputs(inputs = {}) {
    return inputs.aspectRatio || inputs.aspect_ratio || '16:9';
}

function durationFromInputs(inputs = {}, fallback = 5) {
    const value = inputs.duration ?? inputs.duration_seconds;
    return readNumber(value) ?? fallback;
}

function appendCommonVideoParameters(body, request, inputs = {}) {
    appendDefined(body, 'negative_prompt', request.negativePrompt || inputs.negative_prompt);
    appendDefinedIfMissing(body, 'aspect_ratio', inputs.aspectRatio || inputs.aspect_ratio);
    appendDefinedIfMissing(body, 'resolution', inputs.resolution);
    appendDefinedIfMissing(body, 'duration', readNumber(inputs.duration ?? inputs.duration_seconds));
    appendDefinedIfMissing(body, 'size', inputs.size);
    appendDefinedIfMissing(body, 'quality', inputs.quality);
    appendDefinedIfMissing(body, 'mode', inputs.mode);
    appendDefined(body, 'seed', inputs.seed !== -1 ? readNumber(inputs.seed) : undefined);
    appendDefined(body, 'request_id', inputs.requestId || inputs.request_id);
    appendDefined(body, 'camera_fixed', readBoolean(inputs.camera_fixed ?? inputs.cameraFixed));
    appendDefined(body, 'generate_audio', request.audio ?? inputs.generate_audio);
    appendDefined(body, 'audio', request.audio ?? inputs.audio);
    appendDefined(body, 'bgm', readBoolean(inputs.bgm));
    appendDefined(body, 'sound', readBoolean(inputs.sound));
    appendDefined(body, 'keep_original_sound', readBoolean(inputs.keep_original_sound));
    appendDefined(body, 'remove_watermark', readBoolean(inputs.remove_watermark));
    appendDefined(body, 'movement_amplitude', inputs.movement_amplitude);
    appendDefined(body, 'num_videos', readNumber(inputs.num_videos));
    appendDefined(body, 'variety', readNumber(inputs.variety));
    appendDefined(body, 'stylization', readNumber(inputs.stylization));
    appendDefined(body, 'weirdness', readNumber(inputs.weirdness));
    appendDefined(body, 'go_fast', readBoolean(inputs.go_fast ?? inputs.goFast));
    appendDefined(body, 'name', inputs.name);
    appendDefined(body, 'effect_name', inputs.effect_name || inputs.name);
    appendDefined(body, 'style', inputs.style);
    appendDefined(body, 'thinking', inputs.thinking);
    appendDefined(body, 'multi_clip', readBoolean(inputs.multi_clip));
    appendDefined(body, 'shot_type', inputs.shot_type);
    appendDefined(body, 'prompt_optimizer', readBoolean(inputs.prompt_optimizer));
}

function appendWarningForDroppedInput(warnings, label, value) {
    const values = Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
    if (values.length > 0) warnings.push(`${label} input is not accepted by this MemeFast adapter and was dropped.`);
}

function cleanObject(object) {
    for (const key of Object.keys(object)) {
        if (object[key] === undefined || object[key] === null || object[key] === '') delete object[key];
    }
    return object;
}

function imageWithRoles(inputs = {}) {
    return asArray(inputs.imageWithRoles)
        .map((item) => (item && typeof item === 'object' ? item : null))
        .filter((item) => item?.url);
}

function getExplicitFirstFrame(inputs = {}) {
    return imageWithRoles(inputs).find((item) => item.role === 'first_frame')?.url
        || inputs.firstFrame
        || inputs.first_frame
        || inputs.image_url
        || inputs.imageUrl;
}

function getFirstFrame(inputs = {}, images = []) {
    return getExplicitFirstFrame(inputs)
        || images[0];
}

function getExplicitLastFrame(inputs = {}) {
    return imageWithRoles(inputs).find((item) => item.role === 'last_frame')?.url
        || inputs.lastFrame
        || inputs.last_image
        || inputs.last_image_url
        || inputs.end_image_url;
}

function getLastFrame(inputs = {}, images = []) {
    return getExplicitLastFrame(inputs)
        || images[1];
}

function referenceImages(inputs = {}, images = []) {
    return uniqueNonEmpty([
        ...asArray(inputs.referenceImages),
        ...images,
    ]);
}

function throwProvider(code, message, details = {}) {
    throw new ProviderLayerError(code, message, { providerId: 'memefast', ...details });
}

const SORA_VARIANTS = Object.freeze({
    'sora-2': {
        durations: [4, 8, 12],
        resolutions: ['720p'],
        preferUnifiedEndpoint: false,
    },
    'sora-2-pro': {
        durations: [4, 8, 12],
        resolutions: ['720p', '1080p'],
        preferUnifiedEndpoint: false,
    },
    'sora-2-all': {
        durations: [10, 15],
        resolutions: ['720p'],
        preferUnifiedEndpoint: true,
    },
    'sora-2-pro-all': {
        durations: [15, 25],
        resolutions: ['720p', '1080p'],
        preferUnifiedEndpoint: true,
    },
    'sora-2-vip-all': {
        durations: [10],
        resolutions: ['720p'],
        preferUnifiedEndpoint: false,
    },
});

const SORA_UNIFIED_ENDPOINT_TYPES = new Set([
    'openai',
    'openai-response',
    'video unified format',
    'unified',
    '视频统一格式',
]);

function normalizeSoraResolution(resolution) {
    const normalized = String(resolution || '').trim().toLowerCase();
    if (normalized.includes('1080')) return '1080p';
    if (normalized.includes('720')) return '720p';
    return undefined;
}

function soraAspectIsPortrait(aspectRatio) {
    return aspectRatio === '9:16' || aspectRatio === '3:4';
}

function validateSora(modelId, duration, resolution) {
    const profile = SORA_VARIANTS[modelId];
    if (!profile) return;
    if (duration !== undefined && !profile.durations.includes(duration)) {
        throwProvider('model_parameter_invalid', `${modelId} only supports duration ${profile.durations.join(' / ')} seconds`, { modelId });
    }
    const normalizedResolution = normalizeSoraResolution(resolution);
    if (normalizedResolution && !profile.resolutions.includes(normalizedResolution)) {
        throwProvider('model_parameter_invalid', `${modelId} only supports resolution ${profile.resolutions.join(' / ')}`, { modelId });
    }
    if (modelId === 'sora-2-pro-all' && duration === 25 && normalizedResolution === '1080p') {
        throwProvider('model_parameter_invalid', 'sora-2-pro-all 25s only supports 720p', { modelId });
    }
}

function toSoraOfficialSize(modelId, aspectRatio, resolution) {
    const isPro = modelId === 'sora-2-pro' || modelId === 'sora-2-pro-all';
    const isPortrait = soraAspectIsPortrait(aspectRatio);
    if (isPro && normalizeSoraResolution(resolution) === '1080p') {
        return isPortrait ? '1024x1792' : '1792x1024';
    }
    return isPortrait ? '720x1280' : '1280x720';
}

function toSoraUnifiedSize(modelId, resolution) {
    const isPro = modelId === 'sora-2-pro' || modelId === 'sora-2-pro-all';
    return isPro && normalizeSoraResolution(resolution) === '1080p' ? 'large' : 'small';
}

function buildSoraPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const profile = SORA_VARIANTS[modelId];
    const duration = durationFromInputs(inputs, profile?.durations?.[0] || 10);
    validateSora(modelId, duration, inputs.resolution);
    const first = getFirstFrame(inputs, images);
    const endpointTypes = asArray(inputs.endpointTypes);
    const useUnified = profile?.preferUnifiedEndpoint
        && (endpointTypes.length === 0 || endpointTypes.some((type) => SORA_UNIFIED_ENDPOINT_TYPES.has(String(type).trim())));

    if (useUnified) {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            orientation: soraAspectIsPortrait(aspectRatioFromInputs(inputs)) ? 'portrait' : 'landscape',
            duration,
            size: toSoraUnifiedSize(modelId, inputs.resolution),
            images: first ? [first] : [],
        };
        appendCommonVideoParameters(body, request, inputs);
        return videoPlan('sora', 'sora-video', request, modelId, '/v1/video/create', cleanObject(body), {
            operation: first ? 'i2v' : 't2v',
            notes: ['Sora reverse variants use MemeFast unified video create payload.'],
        });
    }

    const body = {
        model: modelId,
        prompt: request.prompt || '',
        size: toSoraOfficialSize(modelId, aspectRatioFromInputs(inputs), inputs.resolution),
        seconds: String(duration),
        input_reference: first,
    };
    return videoPlan('sora', 'sora-video', request, modelId, '/v1/videos', cleanObject(body), {
        operation: first ? 'i2v' : 't2v',
        multipart: true,
        notes: ['Sora official route uses /v1/videos style fields.'],
    });
}

const OPENAI_VEO_TEXT_ONLY = new Set(['veo_3_1-4k']);
const OPENAI_VEO_FIRST_LAST = new Set(['veo_3_1', 'veo_3_1-fast', 'veo_3_1-fast-4k']);
const OPENAI_VEO_SINGLE = new Set(['veo_3_1-components', 'veo_3_1-components-4k']);
const OPENAI_VEO_MULTI = new Set(['veo_3_1-fast-components', 'veo_3_1-fast-components-4k']);
const UNIFIED_VEO_TEXT_ONLY = new Set(['veo2', 'veo2-fast', 'veo2-pro', 'veo3', 'veo3-fast', 'veo3-pro', 'veo3.1-4k', 'veo2-text-to-video']);
const UNIFIED_VEO_FIRST_LAST_OPTIONAL = new Set(['veo3.1', 'veo3.1-fast', 'veo3.1-pro', 'veo3.1-pro-4k']);
const UNIFIED_VEO_FIRST_LAST_REQUIRED = new Set(['veo2-fast-frames']);
const UNIFIED_VEO_SINGLE = new Set(['veo3-fast-frames', 'veo3-frames', 'veo3-pro-frames', 'veo3.1-components-4k']);
const UNIFIED_VEO_MULTI = new Set(['veo2-fast-components', 'veo2-pro-components', 'veo3.1-components', 'veo3.1-fast-components']);

function isOpenAIVeo(modelId) {
    return /^veo_3_1(?:[-_].*)?$/i.test(modelId);
}

function veoCapability(modelId) {
    const lower = modelId.toLowerCase();
    const official = isOpenAIVeo(modelId);
    const family = official ? 'openai_videos' : 'unified';
    const sets = official
        ? { text: OPENAI_VEO_TEXT_ONLY, firstLast: OPENAI_VEO_FIRST_LAST, single: OPENAI_VEO_SINGLE, multi: OPENAI_VEO_MULTI }
        : { text: UNIFIED_VEO_TEXT_ONLY, firstLast: UNIFIED_VEO_FIRST_LAST_OPTIONAL, single: UNIFIED_VEO_SINGLE, multi: UNIFIED_VEO_MULTI };
    if (sets.multi.has(lower) || lower.includes('fast-components')) return { family, mode: 'multi', minFiles: 1, maxFiles: 3, supportsTextToVideo: false };
    if (sets.single.has(lower) || lower.includes('frames')) return { family, mode: 'single', minFiles: 1, maxFiles: 1, supportsTextToVideo: false };
    if (sets.text.has(lower)) return { family, mode: 'none', minFiles: 0, maxFiles: 0, supportsTextToVideo: true };
    if (sets.firstLast.has(lower) || UNIFIED_VEO_FIRST_LAST_REQUIRED.has(lower)) {
        return { family, mode: 'first_last', minFiles: UNIFIED_VEO_FIRST_LAST_REQUIRED.has(lower) ? 1 : 0, maxFiles: 2, supportsTextToVideo: true };
    }
    return { family, mode: 'none', minFiles: 0, maxFiles: 0, supportsTextToVideo: true };
}

function toVeoOpenAiSize(aspectRatio) {
    return aspectRatio === '9:16' ? '9x16' : '16x9';
}

function toGrokAspectRatio(aspectRatio) {
    const normalized = String(aspectRatio || '').trim();
    if (normalized === '1:1') return '1:1';
    if (normalized === '9:16' || normalized === '3:4' || normalized === '2:3') return '2:3';
    return '3:2';
}

function toGrokSize() {
    return '720P';
}

function buildVeoPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    const last = getLastFrame(inputs, images);
    const refs = referenceImages(inputs, images);
    const capability = veoCapability(modelId);
    let selectedImages = [];
    if (capability.mode === 'single') {
        if (first) selectedImages = [first];
    } else if (capability.mode === 'first_last') {
        selectedImages = [first, last].filter(Boolean);
    } else if (capability.mode === 'multi') {
        selectedImages = refs.length > 0 ? refs.slice(0, capability.maxFiles) : [first, last].filter(Boolean).slice(0, capability.maxFiles);
    }
    if (selectedImages.length < capability.minFiles) {
        throwProvider('model_input_required', `Model ${modelId} requires at least ${capability.minFiles} reference image(s).`, { modelId });
    }
    if (capability.family === 'openai_videos') {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            size: toVeoOpenAiSize(aspectRatioFromInputs(inputs)),
            seconds: String(durationFromInputs(inputs, 8)),
            watermark: false,
            input_references: selectedImages.length > 0 ? selectedImages : undefined,
        };
        return videoPlan('veo', 'veo-video', request, modelId, '/v1/videos', cleanObject(body), {
            operation: selectedImages.length > 1 ? 'first_last_frame' : selectedImages.length === 1 ? 'i2v' : 't2v',
            multipart: true,
            notes: [`Veo upload mode: ${capability.mode}`],
        });
    }
    const body = {
        model: modelId,
        prompt: request.prompt || '',
        enhance_prompt: true,
        enable_upsample: true,
        aspect_ratio: aspectRatioFromInputs(inputs),
        images: selectedImages.length > 0 ? selectedImages : undefined,
    };
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('veo', 'veo-video', request, modelId, '/v1/video/create', cleanObject(body), {
        operation: selectedImages.length > 1 ? 'first_last_frame' : selectedImages.length === 1 ? 'i2v' : 't2v',
        notes: [`Veo upload mode: ${capability.mode}`],
    });
}

const SCLASS_GROK_NINE_GRID_GUARD = [
    'Grok Video 3 S-Class nine-grid adapter: use the storyboard/reference image only to understand shot order, character blocking, action relationship, spatial continuity, dialogue rhythm, and atmosphere.',
    'Do not reproduce the reference image layout. Do not output subtitles, tables, nine-grid panels, split-screen, collage, numbers, text, arrows, borders, UI screenshots, or storyboard frames.',
    'The final result must be one continuous cinematic video, not a grid, poster, storyboard sheet, or screenshot-like layout.',
].join('\n');

const SCLASS_KLING_NINE_GRID_GUARD = [
    'Kling v3 Omni nine-grid adapter: use the storyboard/reference image only to understand shot order, character blocking, action relationship, spatial continuity, dialogue rhythm, and atmosphere.',
    'Do not reproduce the reference image layout. Do not output subtitles, tables, nine-grid panels, split-screen, collage, numbers, text, arrows, borders, UI screenshots, or storyboard frames.',
    'The final result must be one continuous cinematic video, not a grid, poster, storyboard sheet, or screenshot-like layout.',
].join('\n');

const SCLASS_PIXVERSE_NINE_GRID_GUARD = [
    'PixVerse S-Class adapter: use the storyboard/reference image only to understand shot order, character blocking, action relationship, spatial continuity, and atmosphere.',
    'Do not reproduce the reference image layout. Do not output subtitles, tables, nine-grid panels, split-screen, collage, numbers, text, arrows, borders, UI screenshots, or storyboard frames.',
    'The final result must be one continuous cinematic video, not a grid, poster, storyboard sheet, or screenshot-like layout.',
].join('\n');

function appendSClassGuard(prompt, marker, guard) {
    const normalized = String(prompt || '').trim();
    if (normalized.includes(marker)) return normalized;
    return [normalized, guard].filter(Boolean).join('\n\n');
}

function buildSClassMergedPrompt(prompt) {
    return [
        'Use the merged storyboard/reference image as one continuous first-frame plan for the full S-Class video.',
        'Preserve the visual continuity, character identity, wardrobe, lighting direction, and scene order shown in the merged image.',
        'Generate one coherent video, not disconnected clips.',
        normalizeString(prompt) ? `Creative direction: ${normalizeString(prompt)}` : '',
    ].filter(Boolean).join('\n');
}

const SCLASS_MODES = new Set(['standard-group', 'nine-grid-group', 'single-shot', 'merged-grid']);

function sclassModeFromInputs(inputs = {}) {
    const raw = normalizeString(inputs.sclassMode || inputs.sclass_mode);
    if (!raw) return undefined;
    if (!SCLASS_MODES.has(raw)) {
        throwProvider('model_parameter_invalid', `Unsupported S-Class mode: ${raw}`);
    }
    return raw;
}

function storyboardImageFromInputs(inputs = {}) {
    return normalizeString(inputs.storyboardImage || inputs.storyboard_image);
}

function mergedImageFromInputs(inputs = {}) {
    return normalizeString(inputs.mergedImage || inputs.merged_image);
}

function sclassLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeHappyHorseStoryboardPanel(panel) {
    if (!panel || typeof panel !== 'object') return '';
    const parts = [
        panel.sceneName ? `scene ${sclassLine(panel.sceneName)}` : '',
        Array.isArray(panel.characterNames) && panel.characterNames.length
            ? `characters ${panel.characterNames.map(sclassLine).filter(Boolean).join(', ')}`
            : '',
        panel.action ? `action ${sclassLine(panel.action)}` : '',
        panel.camera ? `camera ${sclassLine(panel.camera)}` : '',
    ].filter(Boolean);
    return `Panel ${panel.index}: ${parts.join('; ') || 'continue the visual action shown in this panel'}.`;
}

function buildHappyHorseStoryboardPrompt(inputs = {}, prompt = '') {
    const duration = normalizeHappyHorseDuration(inputs.duration ?? inputs.duration_seconds ?? 15);
    const orderedPanels = asArray(inputs.storyboardPanels || inputs.storyboard_panels)
        .filter((panel) => panel && Number.isFinite(Number(panel.index)))
        .sort((left, right) => Number(left.index) - Number(right.index))
        .slice(0, 9);
    const panelLines = orderedPanels.length > 0
        ? orderedPanels.map(summarizeHappyHorseStoryboardPanel).filter(Boolean)
        : [
            'Panel 1 starts the action.',
            'Panels 2-8 continue the action in reading order.',
            'Panel 9 is the ending beat.',
        ];
    const characterLines = asArray(inputs.characterIdentityLines || inputs.character_identity_lines).map(sclassLine).filter(Boolean);
    const styleLines = asArray(inputs.styleLines || inputs.style_lines).map(sclassLine).filter(Boolean);
    const basePrompt = sclassLine(prompt);

    return [
        'Follow the 3x3 storyboard reference image in reading order from panel 1 to panel 9.',
        `Generate one continuous ${duration}-second video, not nine disconnected clips.`,
        'Use the storyboard as a temporal plan: panel 1 is the opening beat, panel 9 is the ending beat.',
        'Keep the same main character identity, outfit, hairstyle, body shape, lighting direction, color palette, and scene continuity across the whole video.',
        'Do not add extra characters, outfit changes, camera resets, or scene jumps unless explicitly shown in the storyboard.',
        basePrompt ? `Creative direction: ${basePrompt}` : '',
        characterLines.length ? `Character locks: ${characterLines.join(' | ')}` : '',
        styleLines.length ? `Style locks: ${styleLines.join(' | ')}` : '',
        'Storyboard beats:',
        ...panelLines,
    ].filter(Boolean).join('\n');
}

function buildGrokPlan(request, modelId, images, videos, audios) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    const refs = referenceImages(inputs, images);
    const sclassMode = sclassModeFromInputs(inputs);
    const storyboardImage = storyboardImageFromInputs(inputs);
    const mergedImage = mergedImageFromInputs(inputs);
    let selectedImage = first;
    let prompt = request.prompt || '';

    if (sclassMode === 'nine-grid-group') {
        selectedImage = storyboardImage || refs[0] || first;
        if (!selectedImage) {
            throwProvider('model_input_required', 'Grok Video 3 S-Class nine-grid generation requires a storyboard reference image.', { modelId });
        }
        prompt = appendSClassGuard(prompt, 'Grok Video 3 S-Class nine-grid adapter:', SCLASS_GROK_NINE_GRID_GUARD);
    } else if (sclassMode === 'merged-grid') {
        selectedImage = mergedImage || storyboardImage || refs[0] || first;
        if (!selectedImage) {
            throwProvider('model_input_required', 'Grok Video 3 S-Class merged generation requires a merged reference image.', { modelId });
        }
        prompt = appendSClassGuard(prompt, 'Grok Video 3 S-Class nine-grid adapter:', SCLASS_GROK_NINE_GRID_GUARD);
    } else if (sclassMode === 'single-shot' || sclassMode === 'standard-group') {
        selectedImage = first || refs[0];
    }

    const warnings = [];
    appendWarningForDroppedInput(warnings, 'Grok Video 3 video refs', uniqueNonEmpty([...asArray(inputs.videoRefs), ...videos]));
    appendWarningForDroppedInput(warnings, 'Grok Video 3 audio refs', uniqueNonEmpty([...asArray(inputs.audioRefs), ...audios]));
    if (request.audio !== undefined) warnings.push('Grok Video 3 does not accept audio generation toggles in this adapter and was forced silent.');
    if (refs.length > (selectedImage ? 1 : 0)) {
        warnings.push('Grok Video 3 adapter accepts one image only; extra references were dropped.');
    }

    return videoPlan('grok', 'grok-video', request, modelId, '/v1/video/create', cleanObject({
        model: modelId,
        prompt,
        aspect_ratio: toGrokAspectRatio(aspectRatioFromInputs(inputs)),
        size: toGrokSize(inputs.resolution),
        duration: sclassMode ? undefined : durationFromInputs(inputs, undefined),
        mode: inputs.mode,
        images: selectedImage ? [selectedImage] : [],
    }), {
        operation: selectedImage ? 'i2v' : 't2v',
        warnings,
        notes: ['Grok Video 3 request plan does not normalize image pixels; runtime may still normalize to base64 canvas.'],
    });
}

function isOmniFlashComponentsModel(modelId) {
    return /omni[-_ ]?flash(?:[-_ ]?components)/i.test(modelId || '');
}

function resolveOmniFlashReferenceImageLimit(modelId) {
    return isOmniFlashComponentsModel(modelId) ? 4 : 1;
}

function buildOmniFlashPlan(request, modelId, images, videos, audios) {
    const inputs = request.inputs || {};
    const refs = referenceImages(inputs, images);
    const first = getFirstFrame(inputs, refs);
    const last = getLastFrame(inputs, refs);
    const referenceLimit = resolveOmniFlashReferenceImageLimit(modelId);
    const requestedImages = uniqueNonEmpty([first, ...refs]);
    const selectedImages = requestedImages.slice(0, referenceLimit);
    const selectedOperation = selectedImages.length > 1
        ? 'r2v'
        : selectedImages.length === 1
            ? (first ? 'i2v' : 'r2v')
            : 't2v';
    const warnings = [];
    if (requestedImages.length > selectedImages.length) {
        warnings.push(`Omni Flash adapter only forwards ${referenceLimit} reference image(s); extra images were dropped.`);
    }
    if (last) warnings.push('Omni Flash adapter currently ignores last-frame guidance.');
    appendWarningForDroppedInput(warnings, 'Omni Flash video refs', uniqueNonEmpty([...asArray(inputs.videoRefs), ...videos]));
    appendWarningForDroppedInput(warnings, 'Omni Flash audio refs', uniqueNonEmpty([...asArray(inputs.audioRefs), ...audios]));

    return videoPlan('omni_flash', 'omni-flash-video', request, modelId, '/v1/video/create', cleanObject({
        model: modelId,
        prompt: request.prompt || '',
        aspect_ratio: toGrokAspectRatio(aspectRatioFromInputs(inputs)),
        size: toGrokSize(inputs.resolution),
        duration: durationFromInputs(inputs, 5),
        images: selectedImages,
    }), {
        operation: selectedOperation,
        warnings,
        notes: [
            'Omni Flash uses the unified video create route and keeps reference images inline when possible.',
            ...(isOmniFlashComponentsModel(modelId)
                ? ['Omni Flash Components is the multi-reference variant of the Omni Flash adapter.']
                : []),
        ],
    });
}

const HAPPYHORSE_MODELS = Object.freeze({
    t2v: 'happyhorse-1.0-t2v',
    i2v: 'happyhorse-1.0-i2v',
    r2v: 'happyhorse-1.0-r2v',
    videoEdit: 'happyhorse-1.0-video-edit',
});

const HAPPYHORSE_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);

function normalizeHappyHorseOperation(modelId, request, images, videos) {
    const inputs = request.inputs || {};
    const explicit = normalizeString(inputs.operation || request.operation);
    const lowerModel = String(modelId || '').toLowerCase();
    const lowerOperation = String(explicit || '').toLowerCase();

    if (/video[-_]?edit/.test(lowerModel) || lowerOperation === 'video_edit' || lowerOperation === 'v2v') return 'video_edit';
    if (/(?:^|[-_.])r2v(?:$|[-_.])/.test(lowerModel) || lowerOperation === 'r2v' || lowerOperation === 'reference_to_video' || lowerOperation === 'multi_reference_video') return 'r2v';
    if (/(?:^|[-_.])t2v(?:$|[-_.])/.test(lowerModel) || lowerOperation === 't2v' || lowerOperation === 'text_to_video') return 't2v';
    if (/(?:^|[-_.])i2v(?:$|[-_.])/.test(lowerModel) || lowerOperation === 'i2v' || lowerOperation === 'image_to_video') return 'i2v';
    if (videos.length > 0) return 'video_edit';
    if (images.length > 1 || asArray(inputs.referenceImages).length > 1) return 'r2v';
    if (images.length > 0 || getFirstFrame(inputs, images)) return 'i2v';
    return 't2v';
}

function normalizeHappyHorseModel(modelId, operation) {
    const trimmed = normalizeString(modelId);
    if (trimmed && /happyhorse/i.test(trimmed)) return trimmed;
    if (operation === 't2v') return HAPPYHORSE_MODELS.t2v;
    if (operation === 'r2v') return HAPPYHORSE_MODELS.r2v;
    if (operation === 'video_edit') return HAPPYHORSE_MODELS.videoEdit;
    return HAPPYHORSE_MODELS.i2v;
}

function normalizeHappyHorseResolution(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === '720P') return '720P';
    if (normalized === '1080P') return '1080P';
    return '1080P';
}

function normalizeSClassHappyHorseResolutionInput(value) {
    return String(value || '').trim().toLowerCase() === '1080p' ? '1080p' : '720p';
}

function normalizeHappyHorseDuration(value) {
    const number = readNumber(value);
    if (number === undefined) return 5;
    return Math.max(3, Math.min(15, Math.round(number)));
}

function normalizeHappyHorseRatio(value) {
    const normalized = String(value || '').trim();
    return HAPPYHORSE_RATIOS.includes(normalized) ? normalized : '16:9';
}

function normalizeHappyHorseSeed(value) {
    const number = readNumber(value);
    if (number === undefined || !Number.isInteger(number)) return undefined;
    if (number < 0 || number > 2147483647) return undefined;
    return number;
}

function isUsableHappyHorseImageSource(value) {
    const text = String(value || '').trim();
    if (/^https?:\/\//i.test(text)) return true;
    if (/^data:image\/[^;]+;base64,/i.test(text)) return true;
    if (text.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) && !/^[a-z][a-z0-9+.-]*:/i.test(text)) return true;
    return false;
}

function assertHappyHorseImageSource(value) {
    if (isUsableHappyHorseImageSource(value)) return;
    throwProvider('model_input_invalid', 'HappyHorse image input must be an HTTP URL or image base64 payload.');
}

function assertHappyHorseVideoSource(value) {
    if (/^https?:\/\//i.test(String(value || '').trim())) return;
    throwProvider('model_input_invalid', 'HappyHorse video edit input video must be a public HTTP/HTTPS URL.');
}

function buildHappyHorsePlan(request, modelId, images, videos) {
    let inputs = request.inputs || {};
    let effectiveRequest = request;
    let effectiveModelId = modelId;
    let effectiveImages = images;
    const sclassMode = sclassModeFromInputs(inputs);
    if (sclassMode) {
        const explicitFirst = getExplicitFirstFrame(inputs);
        const explicitRefs = asArray(inputs.referenceImages);
        const visualRefs = uniqueNonEmpty([explicitFirst, ...explicitRefs]);
        const storyboardImage = storyboardImageFromInputs(inputs);
        const mergedImage = mergedImageFromInputs(inputs);
        let operation = 't2v';
        let nextPrompt = String(request.prompt || inputs.prompt || '').trim();
        let nextInputs = { ...inputs, resolution: normalizeSClassHappyHorseResolutionInput(inputs.resolution) };

        if (sclassMode === 'nine-grid-group') {
            const boardImage = storyboardImage || explicitRefs[0] || explicitFirst;
            if (!boardImage) {
                throwProvider('model_input_required', 'HappyHorse S-Class nine-grid generation requires a storyboard image.', { modelId });
            }
            operation = 'i2v';
            effectiveModelId = HAPPYHORSE_MODELS.i2v;
            effectiveImages = [boardImage];
            nextPrompt = buildHappyHorseStoryboardPrompt(inputs, nextPrompt);
            nextInputs = {
                ...nextInputs,
                operation,
                imageWithRoles: [{ url: boardImage, role: 'first_frame' }],
                referenceImages: [],
                firstFrame: boardImage,
                image_url: boardImage,
            };
        } else if (sclassMode === 'merged-grid') {
            const image = mergedImage || storyboardImage || explicitRefs[0] || explicitFirst;
            if (!image) {
                throwProvider('model_input_required', 'HappyHorse S-Class merged-grid generation requires a merged reference image.', { modelId });
            }
            operation = 'i2v';
            effectiveModelId = HAPPYHORSE_MODELS.i2v;
            effectiveImages = [image];
            nextPrompt = buildSClassMergedPrompt(nextPrompt);
            nextInputs = {
                ...nextInputs,
                operation,
                imageWithRoles: [{ url: image, role: 'first_frame' }],
                referenceImages: [],
                firstFrame: image,
                image_url: image,
            };
        } else if (sclassMode === 'single-shot') {
            if (explicitFirst) {
                operation = 'i2v';
                effectiveModelId = HAPPYHORSE_MODELS.i2v;
                effectiveImages = [explicitFirst];
                nextInputs = {
                    ...nextInputs,
                    operation,
                    imageWithRoles: [{ url: explicitFirst, role: 'first_frame' }],
                    referenceImages: [],
                    firstFrame: explicitFirst,
                    image_url: explicitFirst,
                };
            } else if (explicitRefs.length > 0) {
                operation = 'r2v';
                effectiveModelId = HAPPYHORSE_MODELS.r2v;
                effectiveImages = explicitRefs;
                nextInputs = { ...nextInputs, operation, imageWithRoles: [], referenceImages: explicitRefs };
            } else {
                effectiveModelId = HAPPYHORSE_MODELS.t2v;
                nextInputs = { ...nextInputs, operation, imageWithRoles: [], referenceImages: [] };
            }
        } else if (visualRefs.length > 0) {
            operation = 'r2v';
            effectiveModelId = HAPPYHORSE_MODELS.r2v;
            effectiveImages = visualRefs;
            nextInputs = { ...nextInputs, operation, imageWithRoles: [], referenceImages: visualRefs };
        } else {
            effectiveModelId = HAPPYHORSE_MODELS.t2v;
            nextInputs = { ...nextInputs, operation, imageWithRoles: [], referenceImages: [] };
        }

        inputs = nextInputs;
        effectiveRequest = { ...request, operation, prompt: nextPrompt, inputs };
    }

    const operation = normalizeHappyHorseOperation(effectiveModelId, effectiveRequest, effectiveImages, sclassMode ? [] : videos);
    const model = normalizeHappyHorseModel(effectiveModelId, operation);
    const prompt = String(effectiveRequest.prompt || inputs.prompt || '').trim();
    const warnings = [];
    const first = getFirstFrame(inputs, effectiveImages);
    const refs = uniqueNonEmpty([
        ...asArray(inputs.referenceImages),
        ...effectiveImages.filter((url) => url !== first),
    ]);
    const media = [];

    if (!prompt && operation !== 'i2v') {
        throwProvider('model_input_required', `HappyHorse ${operation} requires a prompt.`, { modelId });
    }

    if (operation === 'i2v') {
        if (!first) throwProvider('model_input_required', 'HappyHorse I2V requires exactly one first-frame image.', { modelId });
        assertHappyHorseImageSource(first);
        media.push({ type: 'first_frame', url: first });
        if (refs.length > 0) warnings.push('HappyHorse I2V ignores referenceImages; use happyhorse-1.0-r2v for multi-reference generation.');
    } else if (operation === 'r2v') {
        const candidates = uniqueNonEmpty([first, ...refs]);
        if (candidates.length === 0) throwProvider('model_input_required', 'HappyHorse R2V requires 1 to 9 reference images.', { modelId });
        const limited = candidates.slice(0, 9);
        if (candidates.length > limited.length) warnings.push('HappyHorse R2V supports at most 9 reference images; extra images were ignored.');
        for (const url of limited) {
            assertHappyHorseImageSource(url);
            media.push({ type: 'reference_image', url });
        }
    } else if (operation === 'video_edit') {
        const videoUrl = normalizeString(inputs.videoUrl || inputs.video_url) || videos[0];
        if (!videoUrl) throwProvider('model_input_required', 'HappyHorse video edit requires a source video URL.', { modelId });
        assertHappyHorseVideoSource(videoUrl);
        media.push({ type: 'video', url: videoUrl });
        const limited = refs.slice(0, 5);
        if (refs.length > limited.length) warnings.push('HappyHorse video edit supports at most 5 reference images; extra images were ignored.');
        for (const url of limited) {
            assertHappyHorseImageSource(url);
            media.push({ type: 'reference_image', url });
        }
    }

    const input = {};
    if (prompt) input.prompt = prompt;
    if (media.length > 0) input.media = media;

    const resolution = normalizeHappyHorseResolution(inputs.resolution);
    if (inputs.resolution && String(inputs.resolution).trim().toUpperCase() !== resolution) {
        warnings.push(`HappyHorse supports only 720P/1080P resolution; ${inputs.resolution} was normalized to ${resolution}.`);
    }

    const parameters = {
        resolution,
        watermark: readBoolean(inputs.watermark) ?? false,
    };
    const seed = normalizeHappyHorseSeed(inputs.seed);
    if (seed !== undefined) parameters.seed = seed;

    if (operation === 't2v' || operation === 'r2v') {
        const ratio = normalizeHappyHorseRatio(aspectRatioFromInputs(inputs));
        if ((inputs.aspectRatio || inputs.aspect_ratio) && String(inputs.aspectRatio || inputs.aspect_ratio).trim() !== ratio) {
            warnings.push(`HappyHorse ${operation.toUpperCase()} supports only ${HAPPYHORSE_RATIOS.join(', ')} ratio; ${inputs.aspectRatio || inputs.aspect_ratio} was normalized to ${ratio}.`);
        }
        parameters.ratio = ratio;
        parameters.duration = normalizeHappyHorseDuration(inputs.duration ?? inputs.duration_seconds);
    } else if (operation === 'i2v') {
        parameters.duration = normalizeHappyHorseDuration(inputs.duration ?? inputs.duration_seconds);
    }

    return videoPlan('happyhorse', 'happyhorse-video', effectiveRequest, effectiveModelId, '/alibailian/api/v1/services/aigc/video-generation/video-synthesis', {
        model,
        input,
        parameters,
    }, {
        operation,
        warnings,
        notes: ['HappyHorse uses the dedicated Alibaba Bailian video-synthesis payload through MemeFast.'],
    });
}

function normalizeKlingModelName(modelId, modelVersion) {
    const explicit = normalizeString(modelVersion);
    if (explicit) return explicit;
    const lower = modelId.toLowerCase();
    if (/kling[-_ ]?(?:o1|omni|video-o1)|v3[-_ ]?omni/.test(lower)) return 'kling-v3-omni';
    if (/v3[._-]?0.*standard|v3.*standard|std/.test(lower)) return 'kling-v3';
    if (/v3/.test(lower)) return 'kling-v3';
    if (/v2[._-]?6/.test(lower)) return 'kling-v2-6';
    if (/v2[._-]?5/.test(lower)) return 'kling-v2-5-turbo';
    if (/v2[._-]?1.*master/.test(lower)) return 'kling-v2-1-master';
    if (/v2[._-]?1/.test(lower)) return 'kling-v2-1';
    return modelId;
}

function normalizeSClassKlingModelName(modelId, inputs = {}) {
    const lower = String(modelId || '').trim().toLowerCase();
    const endpointTypes = asArray(inputs.endpointTypes).join(' ').toLowerCase();
    if (/video-extend|motion-control|multi-elements|avatar|advanced-lip-sync|lip-sync|effects/.test(`${lower} ${endpointTypes}`)) {
        return normalizeKlingModelName(modelId, inputs.modelVersion);
    }
    if (/kling[-_ ]?(?:o1|omni|video-o1)|v3[-_ ]?omni/.test(lower) || /omni-video|reference2video|multi-image2video/.test(endpointTypes)) {
        return 'kling-v3-omni';
    }
    if (/^(?:kling-video|aigc-video-kling)$/.test(lower) || /kling[-_ ]?v?3/.test(lower)) {
        return 'kling-v3';
    }
    return normalizeKlingModelName(modelId, inputs.modelVersion);
}

function normalizeKlingDuration(value, isOmni, hasReferenceVideo) {
    const duration = Math.round(readNumber(value) ?? 5);
    const max = isOmni && hasReferenceVideo ? 10 : 15;
    return Math.max(3, Math.min(max, duration));
}

function buildKlingPlan(request, modelId, images, videos) {
    const inputs = request.inputs || {};
    const sclassMode = sclassModeFromInputs(inputs);
    let first = getFirstFrame(inputs, images);
    let last = getLastFrame(inputs, images);
    let refs = referenceImages(inputs, images).filter((url) => url !== first && url !== last);
    let videoRefs = uniqueNonEmpty([...asArray(inputs.videoRefs), ...videos]);
    let modelName = sclassMode ? normalizeSClassKlingModelName(modelId, inputs) : normalizeKlingModelName(modelId, inputs.modelVersion);
    let isOmni = modelName === 'kling-v3-omni' || /omni/.test(modelId);
    const referenceLimit = isOmni ? 7 : 1;
    let selectedOperation = inputs.selectedOperation || request.operation;
    let prompt = request.prompt || '';

    if (sclassMode) {
        const explicitFirst = getExplicitFirstFrame(inputs);
        const explicitLast = getExplicitLastFrame(inputs);
        const explicitRefs = uniqueNonEmpty(asArray(inputs.referenceImages));
        const storyboardImage = storyboardImageFromInputs(inputs);
        const mergedImage = mergedImageFromInputs(inputs);

        if (sclassMode === 'nine-grid-group') {
            const boardImage = storyboardImage || explicitRefs[0] || explicitFirst || first;
            if (!boardImage) {
                throwProvider('model_input_required', 'Kling v3 Omni S-Class nine-grid generation requires a storyboard reference image.', { modelId });
            }
            prompt = appendSClassGuard(prompt, 'Kling v3 Omni nine-grid adapter:', SCLASS_KLING_NINE_GRID_GUARD);
            if (isOmni) {
                first = undefined;
                last = undefined;
                refs = uniqueNonEmpty([boardImage, ...explicitRefs]).slice(0, referenceLimit);
                selectedOperation = 'multi_reference_video';
                videoRefs = videoRefs.slice(0, 1);
            } else {
                first = boardImage;
                last = undefined;
                refs = [];
                selectedOperation = 'image_to_video';
                videoRefs = [];
            }
        } else if (sclassMode === 'merged-grid') {
            const image = mergedImage || storyboardImage || explicitRefs[0] || explicitFirst || first;
            if (!image) {
                throwProvider('model_input_required', 'Kling v3 S-Class merged generation requires a merged reference image.', { modelId });
            }
            if (isOmni) {
                prompt = appendSClassGuard(prompt, 'Kling v3 Omni nine-grid adapter:', SCLASS_KLING_NINE_GRID_GUARD);
                first = undefined;
                last = undefined;
                refs = uniqueNonEmpty([image, ...explicitRefs]).slice(0, referenceLimit);
                selectedOperation = 'multi_reference_video';
                videoRefs = videoRefs.slice(0, 1);
            } else {
                first = image;
                last = undefined;
                refs = [];
                selectedOperation = 'image_to_video';
                videoRefs = [];
            }
        } else if (sclassMode === 'single-shot') {
            if (explicitFirst && explicitLast) {
                first = explicitFirst;
                last = explicitLast;
                refs = [];
                selectedOperation = 'first_last_frame_video';
                videoRefs = [];
            } else if (explicitFirst) {
                first = explicitFirst;
                last = undefined;
                refs = [];
                selectedOperation = 'image_to_video';
                videoRefs = [];
            } else if (isOmni && (explicitRefs.length > 0 || videoRefs.length > 0)) {
                first = undefined;
                last = undefined;
                refs = explicitRefs.slice(0, videoRefs.length > 0 ? 4 : referenceLimit);
                selectedOperation = 'multi_reference_video';
                videoRefs = videoRefs.slice(0, 1);
            } else if (explicitRefs[0]) {
                first = explicitRefs[0];
                last = undefined;
                refs = [];
                selectedOperation = 'image_to_video';
                videoRefs = [];
            } else {
                first = undefined;
                last = undefined;
                refs = [];
                selectedOperation = 'text_to_video';
                videoRefs = [];
            }
        } else if (explicitFirst && explicitLast) {
            first = explicitFirst;
            last = explicitLast;
            refs = [];
            selectedOperation = 'first_last_frame_video';
            videoRefs = [];
        } else if (explicitFirst) {
            first = explicitFirst;
            last = undefined;
            refs = [];
            selectedOperation = 'image_to_video';
            videoRefs = [];
        } else if (isOmni && (explicitRefs.length > 0 || videoRefs.length > 0)) {
            first = undefined;
            last = undefined;
            refs = explicitRefs.slice(0, videoRefs.length > 0 ? 4 : referenceLimit);
            selectedOperation = 'multi_reference_video';
            videoRefs = videoRefs.slice(0, 1);
        } else if (explicitRefs[0]) {
            first = explicitRefs[0];
            last = undefined;
            refs = [];
            selectedOperation = 'image_to_video';
            videoRefs = [];
        } else {
            first = undefined;
            last = undefined;
            refs = [];
            selectedOperation = 'text_to_video';
            videoRefs = [];
        }
        isOmni = modelName === 'kling-v3-omni' || /omni/.test(modelId);
    }

    let endpoint = 'text2video';
    const body = {
        model_name: modelName,
        prompt,
        aspect_ratio: aspectRatioFromInputs(inputs),
        duration: String(normalizeKlingDuration(inputs.duration, isOmni, videoRefs.length > 0)),
    };
    const mode = inputs.mode || inputs.quality || (inputs.resolution === '1080p' ? 'pro' : undefined);
    appendDefined(body, 'mode', mode);
    if (/kling-v3|kling-video-o1|kling-v3-omni/.test(modelName) || isOmni) body.sound = 'on';

    if (isOmni && (refs.length > 0 || selectedOperation === 'r2v' || selectedOperation === 'multi_reference_video')) {
        endpoint = 'omni-video';
        body.image_list = uniqueNonEmpty([first, ...refs]).slice(0, referenceLimit).map((imageUrl) => ({ image_url: imageUrl }));
        if (last) body.image_list.push({ image_url: last, type: 'end_frame' });
        if (videoRefs.length > 0) {
            body.video_list = [{
                video_url: videoRefs[0],
                refer_type: 'feature',
                keep_original_sound: 'no',
            }];
        }
    } else if (selectedOperation === 'v2v' || videoRefs.length > 0) {
        endpoint = 'motion-control';
        body.video = videoRefs[0];
        appendDefined(body, 'image', first);
    } else if (first || last || refs.length > 0) {
        const imageList = uniqueNonEmpty([first, ...refs]).slice(0, referenceLimit);
        endpoint = imageList.length > 1 && !last ? 'multi-image2video' : 'image2video';
        if (endpoint === 'multi-image2video') {
            body.image_list = imageList.map((image) => ({ image }));
        } else {
            body.image = first || refs[0];
            appendDefined(body, 'image_tail', last);
        }
    }
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('kling', 'kling-video', request, modelId, `/kling/v1/videos/${endpoint}`, cleanObject(body), {
        operation: endpoint === 'text2video' ? 't2v' : endpoint === 'motion-control' ? 'v2v' : 'i2v',
        notes: [`Kling endpoint path: ${endpoint}`],
    });
}

function buildSeedanceTextContent({ prompt, resolution, ratio, duration, cameraFixed, parameterStyle }) {
    if (parameterStyle === 'short') {
        return [
            prompt,
            resolution ? `--rs ${resolution}` : '',
            ratio ? `--rt ${ratio}` : '',
            typeof duration === 'number' ? `--dur ${duration}` : '',
        ].filter(Boolean).join(' ');
    }
    return [
        prompt,
        resolution ? `--resolution ${resolution}` : '',
        ratio ? `--ratio ${ratio}` : '',
        typeof duration === 'number' ? `--duration ${duration}` : '',
        typeof cameraFixed === 'boolean' ? `--camera_fixed ${cameraFixed}` : '',
    ].filter(Boolean).join(' ');
}

function isSeedance20(modelId) {
    return /(?:seedance-v2\.0|doubao-seedance-2-0)/i.test(modelId);
}

function buildSeedancePlan(request, modelId, images, videos, audios) {
    const inputs = request.inputs || {};
    const seedanceAdapter = inputs.seedanceAdapter === 'ark-official' ? 'ark-official' : 'volc-proxy';
    const parameterStyle = inputs.seedanceParameterStyle === 'short' ? 'short' : 'long';
    const roles = imageWithRoles(inputs);
    const refs = asArray(inputs.referenceImages);
    const normalizedResolution = String(inputs.resolution || '720p').toLowerCase();
    const duration = durationFromInputs(inputs, 5);
    const ratio = aspectRatioFromInputs(inputs);
    const cameraFixed = readBoolean(inputs.camera_fixed ?? inputs.cameraFixed);
    const content = [{
        type: 'text',
        text: seedanceAdapter === 'ark-official'
            ? request.prompt || ''
            : buildSeedanceTextContent({
                prompt: request.prompt || '',
                resolution: normalizedResolution,
                ratio,
                duration,
                cameraFixed,
                parameterStyle,
            }),
    }];
    for (const image of roles) {
        content.push({ type: 'image_url', image_url: { url: image.url }, role: image.role || 'reference_image' });
    }
    for (const imageUrl of refs.length > 0 ? refs : images) {
        if (roles.some((item) => item.url === imageUrl)) continue;
        content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' });
    }
    for (const videoUrl of uniqueNonEmpty([...asArray(inputs.videoRefs), ...videos])) {
        content.push({ type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' });
    }
    for (const audioUrl of uniqueNonEmpty([...asArray(inputs.audioRefs), ...audios])) {
        content.push({ type: 'audio_url', audio_url: { url: audioUrl }, role: 'reference_audio' });
    }
    const body = {
        model: modelId,
        content,
        resolution: normalizedResolution,
        watermark: false,
        ratio,
        duration,
    };
    if (typeof cameraFixed === 'boolean' && !isSeedance20(modelId)) body.camera_fixed = cameraFixed;
    const supportsAudio = /doubao-seedance-(?:1-5-pro|2-0)|seedance-v(?:1\.5|2\.0)/i.test(modelId);
    if (supportsAudio && (request.audio !== undefined || inputs.generate_audio !== undefined)) {
        body.generate_audio = request.audio ?? readBoolean(inputs.generate_audio);
    }
    appendDefined(body, 'service_tier', inputs.serviceTier || inputs.service_tier);
    appendDefined(body, 'draft', readBoolean(inputs.draftMode ?? inputs.draft_mode));
    if (seedanceAdapter === 'volc-proxy') {
        body.req_id = inputs.reqId || inputs.req_id || inputs.requestId || inputs.request_id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        body.messages = [{ role: 'user', content }];
    }
    return videoPlan('seedance', 'seedance-video', request, modelId, seedanceAdapter === 'ark-official' ? '/api/v3/contents/generations/tasks' : '/volc/v1/contents/generations/tasks', cleanObject(body), {
        notes: [`Seedance adapter: ${seedanceAdapter}`],
    });
}

const VIDU_ENDPOINT_PATHS = Object.freeze({
    text: '/ent/v2/text2video',
    image: '/ent/v2/img2video',
    reference: '/ent/v2/reference2video',
    startEnd: '/ent/v2/start-end2video',
});

function normalizeViduModelName(modelId, modelVersion) {
    const explicit = normalizeString(modelVersion);
    if (explicit) return explicit;
    const lower = modelId.toLowerCase();
    if (/q3.*turbo|viduq3-turbo/.test(lower)) return 'viduq3-turbo';
    if (/q3.*pro|viduq3-pro/.test(lower)) return 'viduq3-pro';
    if (/q2.*turbo|viduq2-turbo/.test(lower)) return 'viduq2-turbo';
    if (/q2.*pro|viduq2-pro/.test(lower)) return 'viduq2-pro';
    if (/q2|viduq2/.test(lower)) return 'viduq2';
    if (/q1.*classic|viduq1-classic/.test(lower)) return 'viduq1-classic';
    if (/q1|viduq1/.test(lower)) return 'viduq1';
    if (/v2[._-]?0|vidu2/.test(lower)) return 'vidu2.0';
    return modelId;
}

function buildViduReferencePrompt(prompt, names) {
    const missing = names.filter((name) => !new RegExp(`@${name}(?:\\s|$)`).test(prompt));
    return missing.length > 0 ? `${prompt}\n\nReference anchors: ${missing.map((name) => `@${name} `).join('')}`.trim() : prompt;
}

function buildViduPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    const last = getLastFrame(inputs, images);
    const refs = asArray(inputs.referenceImages);
    const normalizedModel = normalizeViduModelName(modelId, inputs.modelVersion);
    let endpointType = 'text';
    if (request.operation === 'first_last_frame' || (request.operation !== 'r2v' && refs.length === 0 && first && last)) endpointType = 'startEnd';
    else if (request.operation === 'r2v' || refs.length > 0 || images.length > 1) endpointType = 'reference';
    else if (first) endpointType = 'image';
    const body = {
        model: normalizedModel,
        prompt: request.prompt || '',
        duration: durationFromInputs(inputs, undefined),
        resolution: inputs.resolution,
        aspect_ratio: aspectRatioFromInputs(inputs),
    };
    if (endpointType === 'image') {
        if (!first) throwProvider('model_input_required', `Model ${modelId} requires a first-frame image for Vidu image-to-video.`, { modelId });
        body.images = [first];
    } else if (endpointType === 'reference') {
        const subjectUrls = uniqueNonEmpty(refs.length > 0 ? refs : images).slice(0, 7);
        if (subjectUrls.length === 0) throwProvider('model_input_required', `Model ${modelId} requires reference image(s) for Vidu reference-to-video.`, { modelId });
        if (/viduq2-pro/i.test(normalizedModel)) {
            body.images = subjectUrls;
        } else {
            const subjects = subjectUrls.map((url, index) => ({ name: `subject_${index + 1}`, images: [url] }));
            body.subjects = subjects;
            body.prompt = buildViduReferencePrompt(request.prompt || '', subjects.map((subject) => subject.name));
        }
    } else if (endpointType === 'startEnd') {
        const frameImages = [first, last].filter(Boolean);
        if (frameImages.length < 2) throwProvider('model_input_required', `Model ${modelId} requires first and last frame images for Vidu start-end video.`, { modelId });
        body.images = frameImages;
    }
    if (request.audio !== undefined || inputs.audio !== undefined) body.audio = request.audio ?? readBoolean(inputs.audio);
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('vidu', 'vidu-video', request, modelId, VIDU_ENDPOINT_PATHS[endpointType], cleanObject(body), {
        operation: endpointType === 'text' ? 't2v' : endpointType === 'image' ? 'i2v' : endpointType === 'reference' ? 'r2v' : 'first_last_frame',
        notes: [`Vidu endpoint type: ${endpointType}`, `Vidu model: ${normalizedModel}`],
    });
}

const PIXVERSE_ENDPOINTS = Object.freeze({
    uploadImage: '/openapi/v2/image/upload',
    textToVideo: '/openapi/v2/video/text/generate',
    imageToVideo: '/openapi/v2/video/img/generate',
    transition: '/openapi/v2/video/transition/generate',
    fusion: '/openapi/v2/video/fusion/generate',
});

const PIXVERSE_VERSIONS = new Set(['c1', 'v6', 'v5.6', 'v5.5', 'v5', 'v4.5', 'v4', 'v3.5']);

function normalizePixVerseVersion(modelId, modelVersion) {
    const explicit = String(modelVersion || '').trim().toLowerCase();
    if (PIXVERSE_VERSIONS.has(explicit)) return explicit;
    const lower = modelId.toLowerCase();
    if (/c1/.test(lower)) return 'c1';
    if (/v6/.test(lower)) return 'v6';
    if (/v5[._-]?6/.test(lower)) return 'v5.6';
    if (/v5[._-]?5/.test(lower)) return 'v5.5';
    if (/v5(?![._-]?\d)/.test(lower)) return 'v5';
    if (/v4[._-]?5/.test(lower)) return 'v4.5';
    if (/v4(?![._-]?\d)/.test(lower)) return 'v4';
    if (/v3[._-]?5/.test(lower)) return 'v3.5';
    return 'v5.5';
}

function pixverseReferenceLimit(version) {
    if (['c1', 'v6'].includes(version)) return 3;
    if (['v5.6', 'v5.5'].includes(version)) return 7;
    if (['v5', 'v4.5'].includes(version)) return 3;
    return 0;
}

function pixverseDurations(version) {
    if (['c1', 'v6'].includes(version)) return Array.from({ length: 15 }, (_, index) => index + 1);
    if (version === 'v5.6' || version === 'v5.5') return [5, 8, 10];
    return [5, 8];
}

function nearestAllowed(candidate, allowed) {
    const numeric = readNumber(candidate);
    if (numeric === undefined) return allowed[0];
    return allowed.reduce((best, value) => Math.abs(value - numeric) < Math.abs(best - numeric) ? value : best, allowed[0]);
}

function pixverseImageId(value, fallbackToken) {
    if (value !== undefined && value !== null && value !== '') return value;
    return fallbackToken ? `__pixverse_upload_required_${fallbackToken}__` : undefined;
}

function buildPixVerseCommonBody(request, inputs, modelVersion) {
    const duration = nearestAllowed(durationFromInputs(inputs, 5), pixverseDurations(modelVersion));
    const body = {
        prompt: request.prompt || '',
        model: modelVersion,
        duration,
        quality: inputs.resolution || inputs.quality || '720p',
    };
    appendDefined(body, 'seed', inputs.seed !== -1 ? readNumber(inputs.seed) : undefined);
    if (request.audio !== undefined || inputs.generate_audio !== undefined) {
        body.generate_audio_switch = request.audio ?? readBoolean(inputs.generate_audio);
    }
    appendCommonVideoParameters(body, request, inputs);
    return body;
}

function buildPixversePlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const sclassMode = sclassModeFromInputs(inputs);
    let first = getFirstFrame(inputs, images);
    let last = getLastFrame(inputs, images);
    let refs = asArray(inputs.referenceImages);
    let effectiveOperation = request.operation;
    let effectiveRequest = request;
    const ids = inputs.pixverseImageIds && typeof inputs.pixverseImageIds === 'object' ? inputs.pixverseImageIds : {};
    const version = normalizePixVerseVersion(modelId, inputs.modelVersion);

    if (sclassMode) {
        const explicitFirst = getExplicitFirstFrame(inputs);
        const explicitLast = getExplicitLastFrame(inputs);
        const explicitRefs = uniqueNonEmpty(asArray(inputs.referenceImages));
        const storyboardImage = storyboardImageFromInputs(inputs);
        const mergedImage = mergedImageFromInputs(inputs);
        let prompt = request.prompt || '';

        if (sclassMode === 'nine-grid-group') {
            const boardImage = storyboardImage || explicitRefs[0] || explicitFirst || first;
            if (!boardImage) {
                throwProvider('model_input_required', 'PixVerse S-Class nine-grid generation requires a storyboard reference image.', { modelId });
            }
            first = boardImage;
            last = undefined;
            refs = [];
            effectiveOperation = 'i2v';
            prompt = appendSClassGuard(prompt, 'PixVerse S-Class adapter:', SCLASS_PIXVERSE_NINE_GRID_GUARD);
        } else if (sclassMode === 'merged-grid') {
            const image = mergedImage || storyboardImage || explicitRefs[0] || explicitFirst || first;
            if (!image) {
                throwProvider('model_input_required', 'PixVerse S-Class merged generation requires a merged reference image.', { modelId });
            }
            first = image;
            last = undefined;
            refs = [];
            effectiveOperation = 'i2v';
            prompt = buildSClassMergedPrompt(prompt);
        } else if (sclassMode === 'single-shot') {
            if (explicitFirst && explicitLast) {
                first = explicitFirst;
                last = explicitLast;
                refs = [];
                effectiveOperation = 'first_last_frame';
            } else if (explicitFirst) {
                first = explicitFirst;
                last = undefined;
                refs = [];
                effectiveOperation = 'i2v';
            } else {
                first = undefined;
                last = undefined;
                refs = explicitRefs;
                effectiveOperation = refs.length > 0 ? 'r2v' : 't2v';
            }
        } else if (explicitFirst && explicitLast) {
            first = explicitFirst;
            last = explicitLast;
            refs = [];
            effectiveOperation = 'first_last_frame';
        } else {
            const referenceCandidates = uniqueNonEmpty([explicitFirst, ...explicitRefs]);
            const canUseFusion = pixverseReferenceLimit(version) > 0;
            if (canUseFusion && referenceCandidates.length > 0) {
                first = undefined;
                last = undefined;
                refs = referenceCandidates;
                effectiveOperation = 'r2v';
            } else if (explicitFirst) {
                first = explicitFirst;
                last = undefined;
                refs = [];
                effectiveOperation = 'i2v';
            } else {
                first = undefined;
                last = undefined;
                refs = [];
                effectiveOperation = 't2v';
            }
        }

        effectiveRequest = { ...request, operation: effectiveOperation, prompt };
    }

    const body = buildPixVerseCommonBody(effectiveRequest, inputs, version);
    const uploadPreparation = { type: 'pixverse_image_upload', firstFrame: first, lastFrame: last, references: refs };
    if (effectiveOperation === 'first_last_frame' || (effectiveOperation !== 'r2v' && refs.length === 0 && first && last)) {
        body.first_frame_img = pixverseImageId(ids.firstFrame || inputs.firstImageId || inputs.first_image_id, 'first_frame');
        body.last_frame_img = pixverseImageId(ids.lastFrame || inputs.lastImageId || inputs.last_image_id, 'last_frame');
        body.motion_mode = 'normal';
        return videoPlan('pixverse', 'pixverse-video', effectiveRequest, modelId, PIXVERSE_ENDPOINTS.transition, cleanObject(body), {
            operation: 'first_last_frame',
            uploadPreparation,
            notes: ['PixVerse transition route requires pre-uploaded first/last image IDs.'],
        });
    }
    if (effectiveOperation === 'r2v' || refs.length > 0 || (!sclassMode && images.length > 1)) {
        const limit = pixverseReferenceLimit(version);
        if (limit <= 0) throwProvider('unsupported_request_plan', `PixVerse ${version} does not support reference-to-video generation.`, { modelId });
        const sourceRefs = uniqueNonEmpty(refs.length > 0 ? refs : images).slice(0, limit);
        const explicitRefs = asArray(ids.references);
        const refNames = sourceRefs.map((_, index) => `ref_${index + 1}`);
        body.image_references = sourceRefs.map((_, index) => ({
            type: 'subject',
            img_id: pixverseImageId(explicitRefs[index], `reference_${index + 1}`),
            ref_name: refNames[index],
        }));
        const missing = refNames.filter((name) => !new RegExp(`@${name}(?:\\s|$)`).test(body.prompt));
        if (missing.length > 0) body.prompt = `${body.prompt}\n\nReference anchors: ${missing.map((name) => `@${name} `).join('')}`.trim();
        appendDefined(body, 'aspect_ratio', aspectRatioFromInputs(inputs));
        return videoPlan('pixverse', 'pixverse-video', effectiveRequest, modelId, PIXVERSE_ENDPOINTS.fusion, cleanObject(body), {
            operation: 'r2v',
            uploadPreparation,
            notes: ['PixVerse fusion route requires pre-uploaded reference image IDs and @ref_name anchors.'],
        });
    }
    if (first) {
        body.img_id = pixverseImageId(ids.firstFrame || inputs.imageId || inputs.image_id, 'first_frame');
        body.motion_mode = 'normal';
        return videoPlan('pixverse', 'pixverse-video', effectiveRequest, modelId, PIXVERSE_ENDPOINTS.imageToVideo, cleanObject(body), {
            operation: 'i2v',
            uploadPreparation,
            notes: ['PixVerse image-to-video route requires one pre-uploaded image ID.'],
        });
    }
    body.aspect_ratio = aspectRatioFromInputs(inputs);
    return videoPlan('pixverse', 'pixverse-video', effectiveRequest, modelId, PIXVERSE_ENDPOINTS.textToVideo, cleanObject(body), {
        operation: 't2v',
        notes: ['PixVerse text-to-video route does not require image upload.'],
    });
}

function normalizeMiniMaxResolution(resolution, duration, hasFirstFrame, hasLastFrame, model) {
    const normalized = String(resolution || '').trim().toUpperCase();
    const requestedDuration = duration >= 8 ? 10 : 6;
    if (normalized === '1080P' && requestedDuration === 6) return '1080P';
    if (normalized === '512P' && /Hailuo-02/i.test(model) && hasFirstFrame && !hasLastFrame) return '512P';
    return '768P';
}

function buildMiniMaxReplicateInput(modelId, prompt, first, refs) {
    const lower = modelId.toLowerCase();
    const subjectReference = refs.find((url) => url && url !== first);
    if (lower === 'minimax-video-01' || lower === 'minimax/video-01') {
        return cleanObject({
            prompt,
            prompt_optimizer: true,
            first_frame_image: first,
            subject_reference: subjectReference,
        });
    }
    if (lower === 'minimax-video-01-live' || lower === 'minimax/video-01-live') {
        if (!first) throwProvider('model_input_required', `Model ${modelId} requires first_frame_image`, { modelId });
        return { prompt, prompt_optimizer: true, first_frame_image: first };
    }
    return null;
}

function normalizeMiniMaxModel(modelId, modelVersion) {
    const explicit = normalizeString(modelVersion);
    if (explicit) return explicit;
    const lower = modelId.toLowerCase();
    if (/2[._-]?3.*fast/.test(lower)) return 'MiniMax-Hailuo-2.3-Fast';
    if (/2[._-]?3/.test(lower)) return 'MiniMax-Hailuo-2.3';
    if (/0?2/.test(lower)) return 'MiniMax-Hailuo-02';
    return modelId;
}

function buildMiniMaxPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    const last = getLastFrame(inputs, images);
    const refs = referenceImages(inputs, images);
    const replicateInput = buildMiniMaxReplicateInput(modelId, request.prompt || '', first, refs);
    if (replicateInput) {
        const providerModel = modelId.includes('/') ? modelId : modelId.replace(/^minimax-video-01/, 'minimax/video-01');
        return videoPlan('minimax', 'minimax-video', request, modelId, `/replicate/v1/models/${providerModel}/predictions`, { input: replicateInput }, {
            operation: first ? 'i2v' : 't2v',
            notes: ['MiniMax Video-01 route uses Replicate-style predictions.'],
        });
    }
    const effectiveModel = normalizeMiniMaxModel(modelId, inputs.modelVersion);
    const duration = durationFromInputs(inputs, 6) >= 8 ? 10 : 6;
    const body = {
        model: effectiveModel,
        prompt: request.prompt || '',
        first_frame_image: first,
        last_frame_image: last && effectiveModel === 'MiniMax-Hailuo-02' ? last : undefined,
        duration: effectiveModel === 'MiniMax-Hailuo-2.3-Fast' ? undefined : duration,
        resolution: normalizeMiniMaxResolution(inputs.resolution, duration, Boolean(first), Boolean(last), effectiveModel),
        prompt_optimizer: readBoolean(inputs.prompt_optimizer),
        remove_watermark: readBoolean(inputs.remove_watermark),
    };
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('minimax', 'minimax-video', request, modelId, '/minimax/v1/video_generation', cleanObject(body), {
        operation: last ? 'first_last_frame' : first ? 'i2v' : 't2v',
        notes: [`MiniMax effective model: ${effectiveModel}`],
    });
}

function normalizeLumaModel(modelId, modelVersion) {
    const explicit = normalizeString(modelVersion);
    if (explicit) return explicit;
    const lower = modelId.toLowerCase();
    if (/ray[-_ ]?2.*flash/.test(lower)) return 'ray-2-flash';
    if (/ray[-_ ]?2|luma/.test(lower)) return 'ray-2';
    return modelId;
}

function buildLumaPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    const last = getLastFrame(inputs, images);
    const body = {
        user_prompt: request.prompt || '',
        expand_prompt: true,
        loop: false,
        resolution: inputs.resolution || '720p',
        duration: `${durationFromInputs(inputs, 5)}s`,
        model_name: normalizeLumaModel(modelId, inputs.modelVersion),
        image_url: first,
        image_end_url: last,
        aspect_ratio: aspectRatioFromInputs(inputs),
    };
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('luma', 'luma-video', request, modelId, '/luma/generations', cleanObject(body), {
        operation: last ? 'first_last_frame' : first ? 'i2v' : 't2v',
        notes: ['Luma request plan covers text, first-frame, and first-last keyframe generation.'],
    });
}

function runwayRatio(aspectRatio) {
    return ({
        '16:9': '1280:720',
        '9:16': '720:1280',
        '1:1': '960:960',
        '4:3': '1104:832',
        '3:4': '832:1104',
    })[aspectRatio] || aspectRatio || '1280:720';
}

function buildRunwayPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = getFirstFrame(inputs, images);
    if (!first) {
        throwProvider('model_input_required', `Model ${modelId} requires a first-frame image for Runway image-to-video.`, { modelId });
    }
    const body = {
        promptImage: first,
        model: /gen4/i.test(modelId) ? 'gen4_turbo' : modelId,
        ratio: runwayRatio(aspectRatioFromInputs(inputs)),
        promptText: request.prompt || '',
        duration: durationFromInputs(inputs, 5) >= 8 ? 10 : 5,
    };
    appendCommonVideoParameters(body, request, inputs);
    return videoPlan('runway', 'runway-video', request, modelId, '/runwayml/v1/image_to_video', cleanObject(body), {
        operation: 'i2v',
        notes: ['Runway request plan is intentionally image-to-video only.'],
    });
}

function videoPlan(family, adapter, request, modelId, endpointPath, body, extras = {}) {
    return {
        family,
        adapter,
        mediaType: 'video',
        operation: extras.operation || request.operation,
        modelId,
        endpointPath,
        body,
        polling: 'task',
        ...(extras.multipart ? { multipart: true } : {}),
        ...(extras.uploadPreparation ? { uploadPreparation: extras.uploadPreparation } : {}),
        ...(extras.warnings ? { warnings: extras.warnings } : {}),
        ...(extras.notes ? { notes: extras.notes } : {}),
    };
}

export function buildSpecializedVideoPlan({ request, modelId, family, images, videos, audios }) {
    if (family === 'sora') return buildSoraPlan(request, modelId, images);
    if (family === 'veo') return buildVeoPlan(request, modelId, images);
    if (family === 'kling') return buildKlingPlan(request, modelId, images, videos);
    if (family === 'grok') return buildGrokPlan(request, modelId, images, videos, audios);
    if (family === 'omni_flash') return buildOmniFlashPlan(request, modelId, images, videos, audios);
    if (family === 'happyhorse') return buildHappyHorsePlan(request, modelId, images, videos);
    if (family === 'seedance') return buildSeedancePlan(request, modelId, images, videos, audios);
    if (family === 'vidu') return buildViduPlan(request, modelId, images);
    if (family === 'pixverse') return buildPixversePlan(request, modelId, images);
    if (family === 'minimax') return buildMiniMaxPlan(request, modelId, images);
    if (family === 'luma') return buildLumaPlan(request, modelId, images);
    if (family === 'runway') return buildRunwayPlan(request, modelId, images);
    return null;
}

async function readJsonResponse(response, label) {
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { message: text };
    }
    if (!response.ok) {
        const message = data?.message || data?.ErrMsg || text || `HTTP ${response.status}`;
        throwProvider('provider_upload_failed', `${label}: ${String(message).slice(0, 300)}`);
    }
    return data;
}

function extractPixVerseImageId(data) {
    const resp = data?.Resp && typeof data.Resp === 'object' ? data.Resp : {};
    const value = resp.img_id ?? resp.id ?? data?.img_id ?? data?.id;
    const id = Number(value);
    if (!Number.isFinite(id)) {
        throwProvider('provider_upload_failed', 'PixVerse image upload did not return Resp.img_id.');
    }
    return id;
}

async function uploadPixVerseImage({ baseUrl, apiKey, imageUrl, fetchImpl }) {
    const root = baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
    const formData = new FormData();
    formData.append('image_url', imageUrl);
    const response = await fetchImpl(`${root}${PIXVERSE_ENDPOINTS.uploadImage}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'API-KEY': apiKey,
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    });
    return extractPixVerseImageId(await readJsonResponse(response, 'PixVerse image upload'));
}

function replaceBodyValue(value, replacements) {
    if (Array.isArray(value)) return value.map((item) => replaceBodyValue(item, replacements));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replaceBodyValue(nested, replacements)]));
    }
    return replacements.has(value) ? replacements.get(value) : value;
}

export async function prepareVideoPlanForSubmit(plan, context) {
    if (plan.uploadPreparation?.type !== 'pixverse_image_upload') return plan;
    const apiKey = context.apiKey || context.apiKeys?.find(Boolean);
    if (!apiKey) return plan;
    const fetchImpl = context.uploadFetch || context.submitFetch || fetch;
    const sources = [
        ['__pixverse_upload_required_first_frame__', plan.uploadPreparation.firstFrame],
        ['__pixverse_upload_required_last_frame__', plan.uploadPreparation.lastFrame],
        ...asArray(plan.uploadPreparation.references).map((url, index) => [`__pixverse_upload_required_reference_${index + 1}__`, url]),
    ].filter(([, url]) => typeof url === 'string' && /^https?:\/\//i.test(url));
    if (sources.length === 0) return plan;
    const replacements = new Map();
    for (const [token, imageUrl] of sources) {
        if (!JSON.stringify(plan.body).includes(token)) continue;
        const imageId = await uploadPixVerseImage({
            baseUrl: context.baseUrl || 'https://memefast.top',
            apiKey,
            imageUrl,
            fetchImpl,
        });
        replacements.set(token, imageId);
    }
    if (replacements.size === 0) return plan;
    return {
        ...plan,
        body: replaceBodyValue(plan.body, replacements),
    };
}
