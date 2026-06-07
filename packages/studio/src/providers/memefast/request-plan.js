import { ProviderLayerError } from '../errors.js';
import {
    getMemefastFamilyManifest,
    inferMemefastFamily,
    isMemefastRequestPlanProven,
    normalizeMemefastModelId,
} from './capabilities.js';
import { buildSpecializedVideoPlan } from './video-family.js';

function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueValues(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const normalized = typeof value === 'string' ? value.trim() : value;
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function readBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
        if (normalized === 'enabled') return true;
        if (normalized === 'disabled') return false;
    }
    return undefined;
}

function readNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

const OPENAI_IMAGE_SIZES = new Set([
    'auto',
    '1024x1024',
    '1536x1024',
    '1024x1536',
]);

const GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO = Object.freeze({
    '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
    '16:9': { '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' },
    '9:16': { '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' },
    '4:3': { '1K': '1152x864', '2K': '2048x1536', '4K': '3264x2448' },
    '3:4': { '1K': '864x1152', '2K': '1536x2048', '4K': '2448x3264' },
    '5:4': { '1K': '1120x896', '2K': '2560x2048', '4K': '3200x2560' },
    '4:5': { '1K': '896x1120', '2K': '2048x2560', '4K': '2560x3200' },
    '3:2': { '1K': '1248x832', '2K': '1536x1024', '4K': '3456x2304' },
    '2:3': { '1K': '832x1248', '2K': '1024x1536', '4K': '2304x3456' },
});

const GPT_IMAGE_2_GENERATION_SIZES = new Set([
    'auto',
    ...Object.values(GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO).flatMap((sizes) => Object.values(sizes)),
]);

const GEMINI_IMAGE_BASE_DIMS = Object.freeze({
    '1:1': { width: 1024, height: 1024 },
    '16:9': { width: 1536, height: 864 },
    '9:16': { width: 864, height: 1536 },
    '4:3': { width: 1152, height: 864 },
    '3:4': { width: 864, height: 1152 },
    '3:2': { width: 1248, height: 832 },
    '2:3': { width: 832, height: 1248 },
    '5:4': { width: 1120, height: 896 },
    '4:5': { width: 896, height: 1120 },
    '21:9': { width: 1512, height: 648 },
});

const GEMINI_IMAGE_RESOLUTION_MULTIPLIER = Object.freeze({
    '512': 0.5,
    '1K': 1,
    '2K': 2,
    '3K': 3,
    '4K': 4,
});

const MEMEFAST_GPT_IMAGE_VARIANTS = Object.freeze({
    'gpt-image-2': {
        outputFormatField: 'output_format',
        generationSizes: GPT_IMAGE_2_GENERATION_SIZES,
        editSizes: OPENAI_IMAGE_SIZES,
    },
    'gpt-image-2-all': {
        outputFormatField: 'output_format',
        generationSizes: GPT_IMAGE_2_GENERATION_SIZES,
        editSizes: OPENAI_IMAGE_SIZES,
    },
});

function resolveOutputFormatField(variant, endpointPath) {
    if (endpointPath === '/v1/images/edits') return 'output_format';
    return variant.outputFormatField;
}

const OPENAI_IMAGE_BACKGROUNDS = new Set(['opaque', 'auto']);
const OPENAI_IMAGE_MODERATIONS = new Set(['low', 'auto']);
const OPENAI_IMAGE_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const OPENAI_IMAGE_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);

function readInteger(value) {
    const number = readNumber(value);
    return number === undefined ? undefined : Math.trunc(number);
}

function normalizeString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeEnumValue(value, allowed) {
    const normalized = normalizeString(value)?.toLowerCase();
    if (!normalized) return undefined;
    return allowed.has(normalized) ? normalized : undefined;
}

function normalizeOutputFormat(value) {
    const normalized = normalizeString(value)?.toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'jpg') return 'jpeg';
    return OPENAI_IMAGE_OUTPUT_FORMATS.has(normalized) ? normalized : undefined;
}

function normalizeBackground(value) {
    const normalized = normalizeString(value)?.toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'transparent') return 'auto';
    return OPENAI_IMAGE_BACKGROUNDS.has(normalized) ? normalized : undefined;
}

function sanitizeImageCount(value) {
    const normalized = readInteger(value);
    if (!normalized) return 1;
    return Math.max(1, Math.min(10, normalized));
}

function inferMemefastImageOrientation(aspectRatio) {
    switch (String(aspectRatio || '').trim()) {
        case '9:16':
        case '3:4':
        case '2:3':
        case '4:5':
        case '9:21':
        case '16:21':
            return 'portrait';
        case '16:9':
        case '4:3':
        case '3:2':
        case '5:4':
        case '21:9':
        case '2:1':
            return 'landscape';
        default:
            return 'square';
    }
}

function mapAspectRatioToOpenAIImageSize(aspectRatio) {
    switch (inferMemefastImageOrientation(aspectRatio)) {
        case 'portrait':
            return '1024x1536';
        case 'landscape':
            return '1536x1024';
        default:
            return '1024x1024';
    }
}

function mapResolutionToQuality(resolution) {
    switch (String(resolution || '').trim().toUpperCase()) {
        case '1K':
            return 'low';
        case '2K':
            return 'medium';
        case '4K':
            return 'high';
        default:
            return undefined;
    }
}

function normalizeGptImageResolutionTier(resolution) {
    const normalized = String(resolution || '').trim().toUpperCase();
    if (normalized === '1K' || normalized === '4K') return normalized;
    return '2K';
}

function normalizeGeminiImageResolution(resolution) {
    const normalized = String(resolution || '2K').trim().toUpperCase();
    if (normalized === '512') return '512';
    if (['1K', '2K', '3K', '4K'].includes(normalized)) return normalized;
    return '2K';
}

function getGeminiImageTargetDimensions(aspectRatio, resolution) {
    const base = GEMINI_IMAGE_BASE_DIMS[aspectRatio || '1:1'];
    if (!base) return null;
    const multiplier = GEMINI_IMAGE_RESOLUTION_MULTIPLIER[normalizeGeminiImageResolution(resolution)] || 2;
    return {
        width: base.width * multiplier,
        height: base.height * multiplier,
    };
}

function mapAspectRatioToGptImage2Size(aspectRatio, resolution, allowedSizes) {
    const ratioSizes = aspectRatio ? GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO[aspectRatio] : undefined;
    if (!ratioSizes) return undefined;

    const tier = normalizeGptImageResolutionTier(resolution);
    const exactSize = ratioSizes[tier] || ratioSizes['2K'];
    if (allowedSizes.has(exactSize)) return exactSize;

    const fallbackStandardSize = mapAspectRatioToOpenAIImageSize(aspectRatio);
    return allowedSizes.has(fallbackStandardSize) ? fallbackStandardSize : undefined;
}

function normalizeMemefastImageSize(value, allowedSizes) {
    const normalized = normalizeString(value)?.toLowerCase();
    if (!normalized) return undefined;
    return allowedSizes.has(normalized) ? normalized : undefined;
}

function buildPromptWithNegativeConstraints(prompt, negativePrompt) {
    const normalizedNegative = normalizeString(negativePrompt);
    if (!normalizedNegative) return prompt;
    return `${prompt}\n\nNegative constraints: ${normalizedNegative}`;
}

function cleanObject(object) {
    for (const key of Object.keys(object)) {
        if (object[key] === undefined || object[key] === null || object[key] === '') delete object[key];
    }
    return object;
}

function readImages(inputs = {}) {
    return uniqueValues([
        ...asArray(inputs.imageWithRoles).map((item) => item?.url).filter(Boolean),
        ...asArray(inputs.referenceImages),
        ...asArray(inputs.imageUrls),
        ...asArray(inputs.images_list),
        inputs.first_image,
        inputs.firstFrame,
        inputs.last_image,
        inputs.last_image_url,
        inputs.lastFrame,
        inputs.end_image_url,
        inputs.imageUrl,
        inputs.image_url,
    ]);
}

function readVideos(inputs = {}) {
    return uniqueValues([
        ...asArray(inputs.videoRefs),
        ...asArray(inputs.videoUrls),
        ...asArray(inputs.video_files),
        inputs.videoUrl,
        inputs.video_url,
    ]);
}

function readAudios(inputs = {}) {
    return uniqueValues([
        ...asArray(inputs.audioRefs),
        ...asArray(inputs.audioUrls),
        ...asArray(inputs.audios_list),
        inputs.audioUrl,
        inputs.audio_url,
    ]);
}

function imageSizeFromInputs(inputs = {}) {
    if (inputs.size) return inputs.size;
    if (inputs.resolution && /^\d+x\d+$/i.test(inputs.resolution)) return inputs.resolution;
    switch (aspectRatioFromInputs(inputs, '1:1')) {
        case '16:9':
            return '1280x720';
        case '9:16':
            return '720x1280';
        case '4:3':
            return '1152x864';
        case '3:4':
            return '864x1152';
        case '3:2':
            return '1248x832';
        case '2:3':
            return '832x1248';
        case '21:9':
            return '1512x648';
        case '1:1':
        default:
            return '1024x1024';
    }
}

function normalizeAspectRatioValue(value) {
    const normalized = normalizeString(value);
    if (!normalized) return undefined;
    return normalized.toLowerCase() === 'auto' ? undefined : normalized;
}

function aspectRatioFromInputs(inputs = {}, fallback = '16:9') {
    return normalizeAspectRatioValue(inputs.aspectRatio) || normalizeAspectRatioValue(inputs.aspect_ratio) || fallback;
}

function durationFromInputs(inputs = {}, fallback = 5) {
    const value = inputs.duration || inputs.duration_seconds;
    return readNumber(value) ?? fallback;
}

function appendDefined(object, key, value) {
    if (value !== undefined && value !== null && value !== '') object[key] = value;
}

function appendDefinedIfMissing(object, key, value) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return;
    appendDefined(object, key, value);
}

function appendCommonImageParameters(body, request, inputs = {}) {
    appendDefined(body, 'negative_prompt', request.negativePrompt || inputs.negative_prompt);
    appendDefinedIfMissing(body, 'aspect_ratio', aspectRatioFromInputs(inputs, undefined));
    appendDefinedIfMissing(body, 'resolution', inputs.resolution);
    appendDefinedIfMissing(body, 'width', readNumber(inputs.width));
    appendDefinedIfMissing(body, 'height', readNumber(inputs.height));
    appendDefinedIfMissing(body, 'num_images', readNumber(inputs.num_images ?? inputs.numImages));
    appendDefinedIfMissing(body, 'num_outputs', readNumber(inputs.num_outputs));
    appendDefinedIfMissing(body, 'quality', inputs.quality);
    appendDefinedIfMissing(body, 'style', inputs.style);
    appendDefinedIfMissing(body, 'strength', readNumber(inputs.strength));
    appendDefined(body, 'seed', inputs.seed !== -1 ? readNumber(inputs.seed) : undefined);
    appendDefinedIfMissing(body, 'guidance_scale', readNumber(inputs.guidance_scale));
    appendDefinedIfMissing(body, 'output_format', inputs.output_format);
    appendDefinedIfMissing(body, 'rendering_speed', inputs.rendering_speed || inputs.render_speed);
    appendDefinedIfMissing(body, 'render_speed', inputs.render_speed);
    appendDefinedIfMissing(body, 'speed', inputs.speed);
    appendDefined(body, 'google_search', readBoolean(inputs.google_search));
    appendDefined(body, 'watermark', readBoolean(inputs.watermark));
    appendDefined(body, 'prompt_extend', readBoolean(inputs.prompt_extend));
    appendDefined(body, 'variety', readNumber(inputs.variety));
    appendDefined(body, 'stylization', readNumber(inputs.stylization));
    appendDefined(body, 'weirdness', readNumber(inputs.weirdness));
    appendDefined(body, 'weight', readNumber(inputs.weight));
    appendDefined(body, 'go_fast', readBoolean(inputs.go_fast ?? inputs.goFast));
    appendDefined(body, 'model_id', inputs.model_id);
    appendDefined(body, 'model_url', inputs.model_url);
    appendDefined(body, 'name', inputs.name);
    appendDefined(body, 'effect_name', inputs.effect_name || inputs.name);
    appendDefined(body, 'target_index', readNumber(inputs.target_index));
    appendDefined(body, 'scene_description', inputs.scene_description);
    appendDefined(body, 'upscale_factor', readNumber(inputs.upscale_factor));
    appendDefined(body, 'rotate_right_left', readNumber(inputs.rotate_right_left));
    appendDefined(body, 'move_forward', readNumber(inputs.move_forward));
    appendDefined(body, 'vertical_angle', readNumber(inputs.vertical_angle));
    appendDefined(body, 'wide_angle_lens', readBoolean(inputs.wide_angle_lens));
    appendDefined(body, 'make_input', inputs.make_input);
    appendDefined(body, 'position', inputs.position);
    appendDefined(body, 'opacity', readNumber(inputs.opacity));
    appendDefined(body, 'scale', readNumber(inputs.scale));
}

function appendCommonVideoParameters(body, request, inputs = {}) {
    appendDefined(body, 'negative_prompt', request.negativePrompt || inputs.negative_prompt);
    appendDefinedIfMissing(body, 'aspect_ratio', aspectRatioFromInputs(inputs, undefined));
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

function isReplicateModel(modelId) {
    return /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?$/i.test(modelId);
}

function buildTextPlan(request, modelId, family) {
    if (request.mediaType !== 'text') return null;
    const inputs = request.inputs || {};
    const messages = Array.isArray(inputs.messages)
        ? inputs.messages
        : [
            ...(inputs.systemPrompt ? [{ role: 'system', content: inputs.systemPrompt }] : []),
            { role: 'user', content: request.prompt || '' },
        ];
    return {
        family,
        adapter: 'openai-chat-llm',
        mediaType: 'text',
        operation: request.operation || 'chat',
        modelId,
        endpointPath: request.operation === 'responses' ? '/v1/responses' : '/v1/chat/completions',
        body: request.operation === 'responses'
            ? {
                model: modelId,
                input: request.prompt || inputs.input || messages,
                ...(inputs.temperature !== undefined ? { temperature: inputs.temperature } : {}),
                ...(inputs.maxTokens !== undefined ? { max_output_tokens: inputs.maxTokens } : {}),
            }
            : {
                model: modelId,
                messages,
                ...(inputs.temperature !== undefined ? { temperature: inputs.temperature } : {}),
                ...(inputs.maxTokens !== undefined ? { max_tokens: inputs.maxTokens } : {}),
            },
        polling: 'none',
    };
}

function buildGptImageBody(request, modelId, images, endpointPath) {
    const inputs = request.inputs || {};
    const variant = MEMEFAST_GPT_IMAGE_VARIANTS[modelId] || MEMEFAST_GPT_IMAGE_VARIANTS['gpt-image-2'];
    const allowedSizes = endpointPath === '/v1/images/edits' ? variant.editSizes : variant.generationSizes;
    const explicitSize = normalizeMemefastImageSize(inputs.size, allowedSizes)
        || normalizeMemefastImageSize(inputs.resolution, allowedSizes);
    const aspectRatio = aspectRatioFromInputs(inputs, '1:1');
    const size = (explicitSize && explicitSize !== 'auto' ? explicitSize : undefined)
        || mapAspectRatioToGptImage2Size(aspectRatio, inputs.resolution, allowedSizes)
        || mapAspectRatioToOpenAIImageSize(aspectRatio);
    const quality = normalizeEnumValue(inputs.quality, OPENAI_IMAGE_QUALITIES)
        || mapResolutionToQuality(inputs.resolution);
    const background = normalizeBackground(inputs.background);
    const moderation = normalizeEnumValue(inputs.moderation, OPENAI_IMAGE_MODERATIONS);
    const outputFormat = normalizeOutputFormat(inputs.format ?? inputs.output_format ?? inputs.outputFormat);
    const outputCompression = readInteger(inputs.output_compression ?? inputs.outputCompression);
    const partialImages = readInteger(inputs.partial_images ?? inputs.partialImages);
    const body = {
        model: modelId,
        prompt: buildPromptWithNegativeConstraints(request.prompt || '', request.negativePrompt || inputs.negative_prompt),
        n: sanitizeImageCount(inputs.n ?? inputs.num_images ?? inputs.numImages),
        size,
    };
    if (images.length > 0) {
        body.images = images.map((imageUrl) => ({ image_url: imageUrl }));
    }
    if (quality) body.quality = quality;
    if (background) body.background = background;
    if (moderation) body.moderation = moderation;
    if (outputFormat) body[resolveOutputFormatField(variant, endpointPath)] = outputFormat;
    if (
        typeof outputCompression === 'number'
        && outputCompression >= 0
        && outputCompression <= 100
        && outputFormat
        && outputFormat !== 'png'
    ) {
        body.output_compression = outputCompression;
    }
    if (typeof partialImages === 'number' && partialImages >= 0 && partialImages <= 3) {
        body.partial_images = partialImages;
    }
    appendDefined(body, 'stream', readBoolean(inputs.stream));
    appendDefined(body, 'user', inputs.user);
    return cleanObject(body);
}

function buildGenericOpenAiImageBody(request, modelId, images) {
    const inputs = request.inputs || {};
    const body = {
        model: modelId,
        prompt: request.prompt || '',
        size: imageSizeFromInputs(inputs),
        n: inputs.num_images || inputs.numImages || inputs.n || 1,
    };
    if (images.length > 0) {
        body.images = images.map((imageUrl) => ({ image_url: imageUrl }));
        body.image_urls = images;
        body.image = images[0];
    }
    appendDefined(body, 'response_format', inputs.response_format);
    appendCommonImageParameters(body, request, inputs);
    return cleanObject(body);
}

function buildGptImagePlan(request, modelId, family, adapter, images) {
    const endpointPath = images.length > 0 ? '/v1/images/edits' : '/v1/images/generations';
    return {
        family,
        adapter,
        mediaType: 'image',
        operation: images.length > 0 ? 'i2i' : request.operation,
        modelId,
        endpointPath,
        body: buildGptImageBody(request, modelId, images, endpointPath),
        polling: 'task',
    };
}

function buildReplicateImagePlan(request, modelId, family, adapter, images) {
    const inputs = request.inputs || {};
    const input = {
        prompt: request.prompt || '',
        image: images[0],
        input_image: images[0],
        image_url: images[0],
        image_urls: images.length > 1 ? images : undefined,
        width: inputs.width,
        height: inputs.height,
        size: imageSizeFromInputs(inputs),
        aspect_ratio: aspectRatioFromInputs(inputs, undefined),
        num_outputs: inputs.num_outputs || inputs.num_images || inputs.numImages || 1,
        output_format: inputs.output_format || 'png',
    };
    appendCommonImageParameters(input, request, inputs);
    cleanObject(input);
    return {
        family,
        adapter,
        mediaType: 'image',
        operation: images.length > 0 ? 'i2i' : request.operation,
        modelId,
        endpointPath: `/replicate/v1/models/${modelId}/predictions`,
        body: { input },
        polling: 'task',
    };
}

function buildFalImagePlan(request, modelId, family, adapter, images) {
    const inputs = request.inputs || {};
    const isEdit = modelId.endsWith('/edit') || images.length > 0;
    const body = {
        prompt: request.prompt || '',
        num_images: Math.max(1, Math.min(4, sanitizeImageCount(inputs.num_images ?? inputs.numImages ?? inputs.n))),
    };
    appendDefined(body, 'aspect_ratio', aspectRatioFromInputs(inputs, undefined));
    if (isEdit && images.length > 0) {
        body.image_urls = images;
    }
    return {
        family,
        adapter,
        mediaType: 'image',
        operation: isEdit ? 'i2i' : 't2i',
        modelId,
        endpointPath: `/${modelId}`,
        body: cleanObject(body),
        polling: 'task',
    };
}

function buildGeminiImagePlan(request, modelId, family, adapter, images) {
    const inputs = request.inputs || {};
    const aspectRatio = aspectRatioFromInputs(inputs, '1:1');
    const targetDims = getGeminiImageTargetDimensions(aspectRatio, inputs.resolution);
    const sizeInstruction = targetDims
        ? ` Output the image at ${targetDims.width}x${targetDims.height} pixels resolution.`
        : '';
    const text = buildPromptWithNegativeConstraints(
        `Generate an image with aspect ratio ${aspectRatio}.${sizeInstruction} ${request.prompt || ''}`,
        request.negativePrompt || inputs.negative_prompt,
    );
    const userContent = [
        { type: 'text', text },
        ...images.map((imageUrl) => ({ type: 'image_url', image_url: { url: imageUrl } })),
    ];
    const messages = [
        ...(inputs.systemPrompt ? [{ role: 'system', content: inputs.systemPrompt }] : []),
        { role: 'user', content: userContent },
    ];
    const resolution = normalizeGeminiImageResolution(inputs.resolution);
    return {
        family,
        adapter: 'gemini-image-chat',
        mediaType: 'image',
        operation: images.length > 0 ? 'i2i' : request.operation,
        modelId,
        endpointPath: '/v1/chat/completions',
        body: cleanObject({
            model: modelId,
            messages,
            max_tokens: readInteger(inputs.max_tokens ?? inputs.maxTokens) || 4096,
            stream: false,
            n: sanitizeImageCount(inputs.n ?? inputs.num_images ?? inputs.numImages),
            image_size: resolution,
            aspect_ratio: aspectRatio,
            generation_config: {
                response_modalities: ['TEXT', 'IMAGE'],
                image_config: {
                    image_size: resolution,
                    aspect_ratio: aspectRatio,
                },
            },
            google_search: readBoolean(inputs.google_search),
            output_format: inputs.output_format,
            name: inputs.name,
            effect_name: inputs.effect_name || inputs.name,
        }),
        polling: 'none',
    };
}

function buildImagePlan(request, modelId, family, manifest) {
    if (request.mediaType !== 'image') return null;
    const inputs = request.inputs || {};
    const images = readImages(inputs);
    const adapter = manifest?.adapter || `${family}-image`;

    if (family === 'gpt_image') {
        return buildGptImagePlan(request, modelId, family, adapter, images);
    }

    if (family === 'fal_image') {
        return buildFalImagePlan(request, modelId, family, adapter, images);
    }

    if (family === 'gemini_image') {
        return buildGeminiImagePlan(request, modelId, family, adapter, images);
    }

    if (isReplicateModel(modelId)) {
        return buildReplicateImagePlan(request, modelId, family, adapter, images);
    }

    if (family === 'kling_image') {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            aspect_ratio: aspectRatioFromInputs(inputs, '1:1'),
            ...(images.length > 0 ? { image: images[0], image_urls: images } : {}),
        };
        appendCommonImageParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'image',
            operation: images.length > 0 ? 'i2i' : 't2i',
            modelId,
            endpointPath: modelId === 'kling-omni-image' ? '/kling/v1/images/omni-image' : '/kling/v1/images/generations',
            body: cleanObject(body),
            polling: 'task',
        };
    }

    if (family === 'ideogram') {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            aspect_ratio: aspectRatioFromInputs(inputs, '1:1').replace(':', 'x'),
            rendering_speed: inputs.rendering_speed || inputs.render_speed,
        };
        appendCommonImageParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'image',
            operation: 't2i',
            modelId,
            endpointPath: '/ideogram/v1/ideogram-v3/generate',
            body: cleanObject(body),
            polling: 'task',
        };
    }

    if (family === 'qwen_image' && modelId === 'aigc-image-qwen') {
        const body = {
            model_name: inputs.model_name || 'Qwen',
            model_version: inputs.model_version || '0925',
            prompt: request.prompt || '',
            ...(images.length > 0 ? { file_infos: images.map((url) => ({ type: 'Url', url })) } : {}),
            output_config: {
                storage_mode: 'Temporary',
                resolution: inputs.resolution || imageSizeFromInputs(inputs),
                person_generation: inputs.person_generation || 'AllowAdult',
                input_compliance_check: inputs.input_compliance_check || 'Enabled',
                output_compliance_check: inputs.output_compliance_check || 'Enabled',
            },
        };
        appendCommonImageParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'image',
            operation: images.length > 0 ? 'i2i' : 't2i',
            modelId,
            endpointPath: '/tencent-vod/v1/aigc-image',
            body: cleanObject(body),
            polling: 'task',
        };
    }

    if (family === 'flux' || family === 'flux_reference') {
        const endpointPath = modelId.startsWith('fal-ai/')
            ? `/${modelId}`
            : (isReplicateModel(modelId) ? `/replicate/v1/models/${modelId}/predictions` : '/v1/images/generations');
        if (endpointPath !== '/v1/images/generations') {
            const body = {
                prompt: request.prompt || '',
                image_url: images[0],
                image_urls: images.length > 1 ? images : undefined,
                aspect_ratio: aspectRatioFromInputs(inputs, undefined),
                num_images: inputs.num_images || inputs.numImages || 1,
                output_format: inputs.output_format || 'jpeg',
            };
            appendCommonImageParameters(body, request, inputs);
            return {
                family,
                adapter,
                mediaType: 'image',
                operation: images.length > 0 ? 'i2i' : 't2i',
                modelId,
                endpointPath,
                body: cleanObject(body),
                polling: 'task',
            };
        }
    }

    return {
        family,
        adapter,
        mediaType: 'image',
        operation: images.length > 0 ? 'i2i' : request.operation,
        modelId,
        endpointPath: '/v1/images/generations',
        body: buildGenericOpenAiImageBody(request, modelId, images),
        polling: 'task',
    };
}

function firstFrame(inputs, images) {
    const withRoles = asArray(inputs.imageWithRoles);
    return withRoles.find((item) => item?.role === 'first_frame')?.url || inputs.firstFrame || inputs.image_url || inputs.imageUrl || images[0];
}

function lastFrame(inputs, images) {
    const withRoles = asArray(inputs.imageWithRoles);
    return withRoles.find((item) => item?.role === 'last_frame')?.url || inputs.lastFrame || inputs.last_image || inputs.end_image_url || images[1];
}

function unifiedVideoBody(request, modelId, images) {
    const inputs = request.inputs || {};
    const body = {
        model: modelId,
        prompt: request.prompt || '',
        aspect_ratio: aspectRatioFromInputs(inputs),
        duration: durationFromInputs(inputs, request.mediaType === 'video' ? 5 : undefined),
        ...(inputs.resolution ? { resolution: inputs.resolution } : {}),
        ...(inputs.size ? { size: inputs.size } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(request.audio !== undefined || inputs.audio !== undefined || inputs.generate_audio !== undefined
            ? { audio: request.audio ?? inputs.audio ?? inputs.generate_audio }
            : {}),
    };
    appendCommonVideoParameters(body, request, inputs);
    return cleanObject(body);
}

function buildKlingVideoPlan(request, modelId, images, videos) {
    const inputs = request.inputs || {};
    const first = firstFrame(inputs, images);
    const last = lastFrame(inputs, images);
    let endpoint = 'text2video';
    const body = {
        model_name: modelId,
        prompt: request.prompt || '',
        aspect_ratio: aspectRatioFromInputs(inputs),
        duration: String(durationFromInputs(inputs, 5)),
    };
    appendDefined(body, 'mode', inputs.mode || inputs.quality);
    appendCommonVideoParameters(body, request, inputs);
    if (request.operation === 'v2v' || videos.length > 0) {
        endpoint = 'motion-control';
        body.video = videos[0];
        appendDefined(body, 'image', first);
    } else if (first || last) {
        endpoint = images.length > 1 && !last ? 'multi-image2video' : 'image2video';
        if (endpoint === 'multi-image2video') {
            body.image_list = images.map((image) => ({ image }));
        } else {
            body.image = first;
            appendDefined(body, 'image_tail', last);
        }
    }
    return {
        family: 'kling',
        adapter: 'kling-video',
        mediaType: 'video',
        operation: request.operation,
        modelId,
        endpointPath: `/kling/v1/videos/${endpoint}`,
        body,
        polling: 'task',
    };
}

function buildSeedancePlan(request, modelId, images, videos, audios) {
    const inputs = request.inputs || {};
    const content = [{ type: 'text', text: request.prompt || '' }];
    for (const image of images) content.push({ type: 'image_url', image_url: { url: image }, role: 'reference_image' });
    for (const video of videos) content.push({ type: 'video_url', video_url: { url: video }, role: 'reference_video' });
    for (const audio of audios) content.push({ type: 'audio_url', audio_url: { url: audio }, role: 'reference_audio' });
    const body = {
        model: modelId,
        content,
        messages: [{ role: 'user', content }],
        resolution: inputs.resolution || '720p',
        watermark: false,
        req_id: inputs.reqId || inputs.req_id || inputs.requestId || inputs.request_id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    appendDefined(body, 'ratio', aspectRatioFromInputs(inputs));
    appendDefined(body, 'duration', durationFromInputs(inputs, 5));
    appendDefined(body, 'generate_audio', request.audio ?? inputs.generate_audio);
    appendDefined(body, 'camera_fixed', readBoolean(inputs.camera_fixed ?? inputs.cameraFixed));
    appendDefined(body, 'service_tier', inputs.serviceTier || inputs.service_tier);
    appendDefined(body, 'draft_mode', readBoolean(inputs.draftMode ?? inputs.draft_mode));
    appendDefined(body, 'frames', readNumber(inputs.frames));
    appendCommonVideoParameters(body, request, inputs);
    return {
        family: 'seedance',
        adapter: 'seedance-video',
        mediaType: 'video',
        operation: request.operation,
        modelId,
        endpointPath: '/volc/v1/contents/generations/tasks',
        body,
        polling: 'task',
    };
}

function buildViduPlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const first = firstFrame(inputs, images);
    const last = lastFrame(inputs, images);
    let endpointPath = '/ent/v2/text2video';
    const body = {
        model: inputs.modelVersion || modelId,
        prompt: request.prompt || '',
        duration: durationFromInputs(inputs, 4),
        resolution: inputs.resolution || '720p',
    };
    if (request.operation === 'first_last_frame' || (first && last)) {
        endpointPath = '/ent/v2/start-end2video';
        body.images = [first, last].filter(Boolean);
    } else if (request.operation === 'r2v' || images.length > 1) {
        endpointPath = '/ent/v2/reference2video';
        body.images = images;
        body.subjects = images.map((url, index) => ({ name: `subject_${index + 1}`, images: [url] }));
    } else if (first) {
        endpointPath = '/ent/v2/img2video';
        body.images = [first];
    }
    appendDefined(body, 'aspect_ratio', aspectRatioFromInputs(inputs));
    appendDefined(body, 'audio', request.audio ?? inputs.audio);
    appendCommonVideoParameters(body, request, inputs);
    return {
        family: 'vidu',
        adapter: 'vidu-video',
        mediaType: 'video',
        operation: request.operation,
        modelId,
        endpointPath,
        body,
        polling: 'task',
    };
}

function buildPixversePlan(request, modelId, images) {
    const inputs = request.inputs || {};
    const body = {
        prompt: request.prompt || '',
        model: inputs.modelVersion || modelId,
        duration: durationFromInputs(inputs, 5),
        quality: inputs.resolution || '720p',
    };
    appendDefined(body, 'aspect_ratio', aspectRatioFromInputs(inputs));
    appendDefined(body, 'generate_audio_switch', request.audio ?? inputs.generate_audio);
    appendCommonVideoParameters(body, request, inputs);
    appendDefined(body, 'thinking', inputs.thinking);
    if (request.operation === 'first_last_frame' && images.length >= 2) {
        body.first_frame_img = inputs.firstImageId || inputs.first_image_id || images[0];
        body.last_frame_img = inputs.lastImageId || inputs.last_image_id || images[1];
        return { endpointPath: '/openapi/v2/video/transition/generate', body, operation: 'first_last_frame' };
    }
    if ((request.operation === 'r2v' || images.length > 1) && images.length > 0) {
        body.image_references = images.map((image, index) => ({
            type: 'subject',
            img_id: asArray(inputs.pixverseImageIds)[index] || image,
            ref_name: `ref_${index + 1}`,
        }));
        return { endpointPath: '/openapi/v2/video/fusion/generate', body, operation: 'r2v' };
    }
    if (images[0]) {
        body.img_id = inputs.imageId || inputs.image_id || images[0];
        return { endpointPath: '/openapi/v2/video/img/generate', body, operation: 'i2v' };
    }
    return { endpointPath: '/openapi/v2/video/text/generate', body, operation: 't2v' };
}

function buildVideoPlan(request, modelId, family, manifest) {
    if (request.mediaType !== 'video') return null;
    const inputs = request.inputs || {};
    const images = readImages(inputs);
    const videos = readVideos(inputs);
    const audios = readAudios(inputs);
    const adapter = manifest?.adapter || `${family}-video`;

    const specializedPlan = buildSpecializedVideoPlan({
        request,
        modelId,
        family,
        images,
        videos,
        audios,
    });
    if (specializedPlan) return specializedPlan;

    if (isReplicateModel(modelId)) {
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: request.operation,
            modelId,
            endpointPath: `/replicate/v1/models/${modelId}/predictions`,
            body: { input: unifiedVideoBody(request, modelId, images) },
            polling: 'task',
        };
    }

    if (family === 'seedance') return buildSeedancePlan(request, modelId, images, videos, audios);
    if (family === 'kling') return buildKlingVideoPlan(request, modelId, images, videos);
    if (family === 'vidu') {
        return buildViduPlan(request, modelId, images);
    }
    if (family === 'pixverse') {
        const plan = buildPixversePlan(request, modelId, images);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: plan.operation,
            modelId,
            endpointPath: plan.endpointPath,
            body: plan.body,
            polling: 'task',
        };
    }
    if (family === 'happyhorse' || family === 'wan') {
        const parameters = {
            resolution: (inputs.resolution || '720p').toUpperCase(),
            duration: durationFromInputs(inputs, 5),
            prompt_extend: true,
            audio: request.audio ?? inputs.audio,
            camera_fixed: readBoolean(inputs.camera_fixed ?? inputs.cameraFixed),
            negative_prompt: request.negativePrompt || inputs.negative_prompt,
        };
        appendCommonVideoParameters(parameters, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: request.operation,
            modelId,
            endpointPath: '/alibailian/api/v1/services/aigc/video-generation/video-synthesis',
            body: {
                model: modelId,
                input: {
                    prompt: request.prompt || '',
                    img_url: images[0],
                    video_url: videos[0],
                },
                parameters: cleanObject(parameters),
            },
            polling: 'task',
        };
    }
    if (family === 'minimax') {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            first_frame_image: images[0],
            last_frame_image: images[1],
            duration: durationFromInputs(inputs, 6),
            resolution: inputs.resolution || '768P',
            prompt_optimizer: readBoolean(inputs.prompt_optimizer),
            remove_watermark: readBoolean(inputs.remove_watermark),
        };
        appendCommonVideoParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: images.length > 0 ? 'i2v' : 't2v',
            modelId,
            endpointPath: '/minimax/v1/video_generation',
            body: cleanObject(body),
            polling: 'task',
        };
    }
    if (family === 'hunyuan' || family === 'ovi' || family === 'ltx' || family === 'midjourney_video' || family === 'leonardo_video' || family === 'effects') {
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: images.length > 0 ? 'i2v' : request.operation,
            modelId,
            endpointPath: '/v1/video/create',
            body: cleanObject({
                ...unifiedVideoBody(request, modelId, images),
                video_url: videos[0],
                effect_name: inputs.name || inputs.effect_name,
            }),
            polling: 'task',
        };
    }
    if (family === 'video_tool') {
        const body = {
            model: modelId,
            prompt: request.prompt || '',
            video_url: videos[0],
            operation: inputs.operation || 'remove_watermark',
            remove_watermark: readBoolean(inputs.remove_watermark) ?? true,
        };
        appendCommonVideoParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: request.operation || 'v2v',
            modelId,
            endpointPath: '/v1/video/create',
            body: cleanObject(body),
            polling: 'task',
        };
    }
    if (family === 'luma') {
        const body = {
            user_prompt: request.prompt || '',
            model_name: modelId,
            resolution: inputs.resolution || '720p',
            duration: `${durationFromInputs(inputs, 5)}s`,
            image_url: images[0],
            image_end_url: images[1],
            aspect_ratio: aspectRatioFromInputs(inputs),
        };
        appendCommonVideoParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: images.length > 0 ? 'i2v' : 't2v',
            modelId,
            endpointPath: '/luma/generations',
            body: cleanObject(body),
            polling: 'task',
        };
    }
    if (family === 'runway') {
        const body = {
            promptText: request.prompt || '',
            promptImage: images[0],
            model: modelId,
            ratio: aspectRatioFromInputs(inputs),
            duration: durationFromInputs(inputs, 5),
            seed: inputs.seed !== -1 ? readNumber(inputs.seed) : undefined,
        };
        appendCommonVideoParameters(body, request, inputs);
        return {
            family,
            adapter,
            mediaType: 'video',
            operation: images.length > 0 ? 'i2v' : 't2v',
            modelId,
            endpointPath: images.length > 0 ? '/runwayml/v1/image_to_video' : '/runwayml/v1/text_to_video',
            body: cleanObject(body),
            polling: 'task',
        };
    }

    return {
        family,
        adapter,
        mediaType: 'video',
        operation: images.length > 0 ? 'i2v' : request.operation,
        modelId,
        endpointPath: family === 'sora' || family === 'veo' || family === 'grok' || family === 'omni_flash'
            ? '/v1/video/create'
            : '/v1/video/create',
        body: unifiedVideoBody(request, modelId, images),
        polling: 'task',
    };
}

function buildAudioPlan(request, modelId, family, manifest) {
    if (request.mediaType !== 'audio') return null;
    const inputs = request.inputs || {};
    const audios = readAudios(inputs);
    if (family === 'suno') {
        const isLyrics = request.operation === 'lyrics' || /lyrics/i.test(modelId);
        const body = isLyrics
            ? { prompt: request.prompt || inputs.prompt || '' }
            : {
                gpt_description_prompt: request.prompt || inputs.prompt || '',
                ...(inputs.lyrics ? { prompt: inputs.lyrics } : {}),
                ...(inputs.style ? { tags: inputs.style } : {}),
                ...(inputs.tags ? { tags: inputs.tags } : {}),
                ...(inputs.title ? { title: inputs.title } : {}),
                ...(inputs.model ? { mv: inputs.model } : {}),
                ...(audios[0] ? { audio_url: audios[0] } : {}),
            };
        appendDefined(body, 'voice_name', inputs.voice_name);
        appendDefined(body, 'description', inputs.description);
        appendDefined(body, 'language', inputs.language);
        appendDefined(body, 'mv', inputs.mv || inputs.version || inputs.model);
        appendDefined(body, 'custom_mode', readBoolean(inputs.custom_mode ?? inputs.customMode));
        appendDefined(body, 'make_instrumental', readBoolean(inputs.instrumental ?? inputs.make_instrumental ?? inputs.makeInstrumental));
        appendDefined(body, 'negative_tags', inputs.negative_tags || inputs.negativeTags);
        appendDefined(body, 'vocal_gender', inputs.vocal_gender);
        appendDefined(body, 'style_weight', readNumber(inputs.style_weight));
        appendDefined(body, 'weirdness_constraint', readNumber(inputs.weirdness_constraint));
        appendDefined(body, 'audio_weight', readNumber(inputs.audio_weight));
        appendDefined(body, 'persona_id', inputs.persona_id);
        appendDefined(body, 'persona_model', inputs.persona_model);
        appendDefined(body, 'continue_at', readNumber(inputs.continue_at ?? inputs.continueAt));
        appendDefined(body, 'continue_clip_id', inputs.continue_clip_id || inputs.continueClipId);
        appendDefined(body, 'task_id', inputs.task_id || inputs.taskId);
        appendDefined(body, 'sound_loop', readBoolean(inputs.sound_loop));
        appendDefined(body, 'sound_tempo', readNumber(inputs.sound_tempo));
        appendDefined(body, 'sound_key', inputs.sound_key);
        appendDefined(body, 'grab_lyrics', readBoolean(inputs.grab_lyrics));
        appendDefined(body, 'vocal_start_s', readNumber(inputs.vocal_start_s));
        appendDefined(body, 'vocal_end_s', readNumber(inputs.vocal_end_s));
        return {
            family,
            adapter: isLyrics ? 'suno-lyrics' : 'suno-music',
            mediaType: 'audio',
            operation: isLyrics ? 'lyrics' : 'music',
            modelId,
            endpointPath: isLyrics ? '/suno/submit/lyrics' : '/suno/submit/music',
            body: cleanObject(body),
            polling: 'task',
        };
    }
    if (/voice[-_]?clone/i.test(modelId) || /voice[-_]?clone/i.test(request.operation || '')) {
        throw new ProviderLayerError(
            'unsupported_request_plan',
            'MemeFast voice clone endpoint is not verified; refusing to route voice clone through the generic TTS endpoint.',
            { providerId: 'memefast', modelId, mediaType: 'audio', operation: request.operation || 'tts', family }
        );
    }
    return {
        family,
        adapter: manifest?.adapter || 'audio-pool',
        mediaType: 'audio',
        operation: request.operation || 'tts',
        modelId,
        endpointPath: /minimax|speech/i.test(modelId) ? '/minimax/v1/t2a_v2' : '/v1/audio/speech',
        body: cleanObject({
            model: modelId,
            preview_model: inputs.model,
            input: request.prompt || inputs.text || inputs.prompt || '',
            text: request.prompt || inputs.text || inputs.prompt || '',
            voice: inputs.voice || inputs.voice_id || 'alloy',
            audio_url: audios[0],
            voice_id: inputs.voice_id,
            voice_name: inputs.voice_name,
            speed: readNumber(inputs.speed),
            volume: readNumber(inputs.volume),
            pitch: readNumber(inputs.pitch),
            emotion: inputs.emotion,
            language: inputs.language,
            language_boost: inputs.language_boost,
            english_normalization: readBoolean(inputs.english_normalization),
            sample_rate: readNumber(inputs.sample_rate),
            bitrate: readNumber(inputs.bitrate),
            channel: readNumber(inputs.channel),
            format: inputs.format,
            duration: readNumber(inputs.duration),
            description: inputs.description,
            custom_voice_id: inputs.custom_voice_id,
            need_noise_reduction: readBoolean(inputs.need_noise_reduction),
            need_volume_normalization: readBoolean(inputs.need_volume_normalization),
            accuracy: readNumber(inputs.accuracy),
            vocal_start_s: readNumber(inputs.vocal_start_s),
            vocal_end_s: readNumber(inputs.vocal_end_s),
        }),
        polling: 'task',
    };
}

export function buildMemefastRequestPlan(request) {
    const family = inferMemefastFamily(request);
    if (!family) {
        throw new ProviderLayerError(
            'unsupported_request_plan',
            `No MemeFast family for ${request.mediaType}:${request.operation}:${request.modelId}`,
            { providerId: 'memefast', modelId: request.modelId, mediaType: request.mediaType, operation: request.operation }
        );
    }

    const modelId = normalizeMemefastModelId(request.modelId, request.mediaType, family);
    const manifest = getMemefastFamilyManifest(request.mediaType, family);
    const normalizedRequest = { ...request, modelId };
    const plan = buildTextPlan(normalizedRequest, modelId, family)
        || buildImagePlan(normalizedRequest, modelId, family, manifest)
        || buildVideoPlan(normalizedRequest, modelId, family, manifest)
        || buildAudioPlan(normalizedRequest, modelId, family, manifest);

    if (!plan || !isMemefastRequestPlanProven(plan)) {
        throw new ProviderLayerError(
            'unsupported_request_plan',
            `No MemeFast request-plan for ${request.mediaType}:${request.operation}:${request.modelId}`,
            { providerId: 'memefast', modelId: request.modelId, mediaType: request.mediaType, operation: request.operation, family }
        );
    }
    return {
        ...plan,
        originalModelId: request.modelId,
    };
}
