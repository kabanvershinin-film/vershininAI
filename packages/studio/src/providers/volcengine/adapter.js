import { ProviderLayerError } from '../errors.js';
import { normalizeProviderBaseUrl, readJsonResponse } from '../http.js';

export const VOLCENGINE_ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export const VOLCENGINE_SEEDANCE_20_MODEL_IDS = Object.freeze([
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
]);

const VOLCENGINE_SEEDANCE_20_MODEL_ID_SET = new Set(VOLCENGINE_SEEDANCE_20_MODEL_IDS);

const VOLCENGINE_SEEDANCE_20_MODEL_ALIASES = Object.freeze({
    'doubao-seedance-2-0-260128-i2v': 'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128-i2v': 'doubao-seedance-2-0-fast-260128',
});

function firstApiKey(context) {
    const keys = context.apiKeys?.filter(Boolean) || [];
    return keys[0] || context.apiKey || '';
}

function isHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
    }
    return result;
}

function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
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

function readNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function normalizeVolcengineModelId(modelId) {
    const id = String(modelId || '').trim();
    return VOLCENGINE_SEEDANCE_20_MODEL_ALIASES[id] || id;
}

function normalizeSeedance20Resolution(modelId, resolution, fallback = '720p') {
    const normalized = typeof resolution === 'string' ? resolution.trim().toLowerCase() : '';
    if (!VOLCENGINE_SEEDANCE_20_MODEL_ID_SET.has(modelId)) return normalized || resolution;
    return normalized === '480p' ? '480p' : fallback;
}

function normalizeSeedance20Duration(modelId, duration, fallback = 5, minDurationOverride = 1) {
    const normalized = typeof duration === 'number' && Number.isFinite(duration)
        ? Math.round(duration)
        : undefined;
    if (!VOLCENGINE_SEEDANCE_20_MODEL_ID_SET.has(modelId)) return normalized ?? duration;
    const candidate = normalized ?? fallback;
    const minimumDuration = Math.min(15, Math.max(1, Math.round(minDurationOverride)));
    return Math.min(15, Math.max(minimumDuration, candidate));
}

function trimTrailingSlashes(value) {
    return String(value || '').replace(/\/+$/, '');
}

function isOfficialArkBaseUrl(baseUrl) {
    const normalized = trimTrailingSlashes(String(baseUrl || '').trim());
    return /https?:\/\/ark\.[^/]+\.volces\.com(?:\/|$)/i.test(normalized);
}

function resolveSeedanceGenerationTaskUrls(baseUrl) {
    const normalizedBaseUrl = trimTrailingSlashes(String(baseUrl || '').trim());
    const normalizedLower = normalizedBaseUrl.toLowerCase();

    if (/\/contents\/generations\/tasks$/i.test(normalizedLower)) {
        return {
            submitUrl: normalizedBaseUrl,
            getStatusUrl: (taskId) => `${normalizedBaseUrl}/${encodeURIComponent(taskId)}`,
        };
    }
    if (/\/api\/v\d+$/i.test(normalizedLower)) {
        const submitUrl = `${normalizedBaseUrl}/contents/generations/tasks`;
        return {
            submitUrl,
            getStatusUrl: (taskId) => `${submitUrl}/${encodeURIComponent(taskId)}`,
        };
    }
    if (isOfficialArkBaseUrl(normalizedBaseUrl)) {
        const submitUrl = `${normalizedBaseUrl}/api/v3/contents/generations/tasks`;
        return {
            submitUrl,
            getStatusUrl: (taskId) => `${submitUrl}/${encodeURIComponent(taskId)}`,
        };
    }
    const submitUrl = `${normalizedBaseUrl}/contents/generations/tasks`;
    return {
        submitUrl,
        getStatusUrl: (taskId) => `${submitUrl}/${encodeURIComponent(taskId)}`,
    };
}

function imageWithRoles(inputs = {}) {
    const roles = [];
    for (const item of asArray(inputs.imageWithRoles)) {
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        const role = typeof item?.role === 'string' ? item.role.trim() : 'reference_image';
        if (url) roles.push({ url, role });
    }

    const firstFrame = inputs.firstFrame || inputs.imageUrl || inputs.image_url;
    const lastFrame = inputs.lastFrame || inputs.last_image || inputs.last_image_url || inputs.end_image_url;
    if (typeof firstFrame === 'string' && firstFrame.trim() && !roles.some((item) => item.url === firstFrame.trim())) {
        roles.unshift({ url: firstFrame.trim(), role: 'first_frame' });
    }
    if (typeof lastFrame === 'string' && lastFrame.trim() && !roles.some((item) => item.url === lastFrame.trim())) {
        roles.push({ url: lastFrame.trim(), role: 'last_frame' });
    }

    return roles.map((item) => ({
        url: item.url,
        role: item.role === 'last_frame'
            ? 'last_frame'
            : item.role === 'first_frame'
                ? 'first_frame'
                : 'reference_image',
    }));
}

function buildContent(request, inputs) {
    const content = [{ type: 'text', text: request.prompt || '' }];
    const roles = imageWithRoles(inputs);
    const roleUrls = new Set(roles.map((item) => item.url));

    for (const item of roles) {
        content.push({
            type: 'image_url',
            image_url: { url: item.url },
            role: item.role,
        });
    }

    const referenceImages = uniqueStrings([
        ...asArray(inputs.referenceImages),
        ...asArray(inputs.imageUrls),
    ]);
    for (const imageUrl of referenceImages) {
        if (roleUrls.has(imageUrl)) continue;
        content.push({
            type: 'image_url',
            image_url: { url: imageUrl },
            role: 'reference_image',
        });
    }

    for (const videoUrl of uniqueStrings([...asArray(inputs.videoRefs), ...asArray(inputs.videoUrls)])) {
        content.push({
            type: 'video_url',
            video_url: { url: videoUrl },
            role: 'reference_video',
        });
    }

    for (const audioUrl of uniqueStrings([...asArray(inputs.audioRefs), ...asArray(inputs.audioUrls)])) {
        content.push({
            type: 'audio_url',
            audio_url: { url: audioUrl },
            role: 'reference_audio',
        });
    }

    return content;
}

function assertContentUrlsAreHosted(content, modelId) {
    for (const item of content) {
        const url = item.image_url?.url || item.video_url?.url || item.audio_url?.url;
        if (url && !isHttpUrl(url)) {
            throw new ProviderLayerError('asset_url_invalid', 'Volcengine Seedance 2.0 requires hosted http(s) asset URLs', {
                providerId: 'volcengine',
                modelId,
            });
        }
    }
}

function extractTaskId(data) {
    return (
        data?.id
        || data?.task_id
        || data?.request_id
        || data?.data?.id
        || data?.data?.task_id
        || data?.response?.task_id
        || data?.response?.id
        || data?.result?.task_id
        || data?.result?.id
        || data?.output?.task_id
        || data?.output?.id
        || null
    )?.toString();
}

function extractVideoUrl(data) {
    return (
        data?.content?.video_url
        || data?.data?.content?.video_url
        || data?.output?.video_url
        || data?.data?.output?.video_url
        || data?.result?.video_url
        || data?.output?.url
        || data?.data?.output?.url
        || data?.video_url
        || data?.url
        || null
    );
}

function statusFrom(data) {
    const raw = String(
        data?.status
        || data?.state
        || data?.data?.status
        || data?.output?.status
        || data?.result?.status
        || data?.task_status
        || data?.output?.task_status
        || data?.data?.task_status
        || ''
    ).toLowerCase();
    if (['succeeded', 'success', 'succeed', 'completed', 'done'].includes(raw)) return 'succeeded';
    if (['failed', 'error', 'expired', 'cancelled', 'canceled', 'rejected'].includes(raw)) return 'failed';
    if (['running', 'processing', 'in_progress'].includes(raw)) return 'running';
    return extractVideoUrl(data) ? 'succeeded' : 'queued';
}

export const volcengineAdapter = {
    id: 'volcengine',
    displayName: 'Volcengine Ark',
    capabilities: ['video'],

    buildRequestPlan(request) {
        if (request.mediaType !== 'video') {
            throw new ProviderLayerError('provider_media_unsupported', 'Volcengine Ark adapter only supports video generation', {
                providerId: 'volcengine',
                mediaType: request.mediaType,
            });
        }
        const modelId = normalizeVolcengineModelId(request.modelId);
        if (!VOLCENGINE_SEEDANCE_20_MODEL_ID_SET.has(modelId)) {
            throw new ProviderLayerError('provider_model_unsupported', `Volcengine Ark only supports official Seedance 2.0 model IDs: ${VOLCENGINE_SEEDANCE_20_MODEL_IDS.join(', ')}`, {
                providerId: 'volcengine',
                modelId: request.modelId,
            });
        }
        const inputs = request.inputs || {};
        const durationFloorOverride = readNumber(inputs.durationFloorOverride) || 1;
        const duration = normalizeSeedance20Duration(modelId, readNumber(inputs.duration), 5, durationFloorOverride);
        const resolution = normalizeSeedance20Resolution(modelId, inputs.resolution || '720p', '720p');
        const content = buildContent(request, inputs);
        assertContentUrlsAreHosted(content, modelId);

        const body = {
            model: modelId,
            content,
            duration,
            ratio: inputs.aspectRatio || inputs.aspect_ratio || '16:9',
            resolution,
            generate_audio: request.audio ?? readBoolean(inputs.generate_audio) ?? true,
            watermark: readBoolean(inputs.watermark) ?? false,
        };
        if (inputs.serviceTier || inputs.service_tier) body.service_tier = inputs.serviceTier || inputs.service_tier;
        const draft = readBoolean(inputs.draftMode ?? inputs.draft);
        if (typeof draft === 'boolean') body.draft = draft;
        const enabledTools = asArray(inputs.enabledTools || inputs.tools);
        if (enabledTools.length > 0) body.tools = enabledTools.map((type) => ({ type }));

        return {
            family: 'volcengine_seedance20',
            mediaType: request.mediaType,
            operation: request.operation,
            modelId,
            endpointPath: '/contents/generations/tasks',
            body,
            polling: 'volcengine_seedance_task',
        };
    },

    async submit(plan, context) {
        const apiKey = firstApiKey(context);
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'Volcengine Ark API key is missing', { providerId: 'volcengine' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, VOLCENGINE_ARK_DEFAULT_BASE_URL);
        const taskUrls = resolveSeedanceGenerationTaskUrls(baseUrl);
        const data = await readJsonResponse(await context.submitFetch(taskUrls.submitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(plan.body),
        }), 'Volcengine Seedance submit');
        const taskId = extractTaskId(data);
        const url = extractVideoUrl(data);
        const status = statusFrom(data);
        return {
            providerId: 'volcengine',
            providerTaskId: taskId,
            status: url ? 'succeeded' : status,
            urls: url ? [url] : [],
            raw: data,
        };
    },

    async poll(task, context) {
        const apiKey = firstApiKey(context);
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'Volcengine Ark API key is missing', { providerId: 'volcengine' });
        }
        if (!task.providerTaskId) {
            throw new ProviderLayerError('provider_task_missing', 'Volcengine Seedance task id is missing', { providerId: 'volcengine' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, VOLCENGINE_ARK_DEFAULT_BASE_URL);
        const taskUrls = resolveSeedanceGenerationTaskUrls(baseUrl);
        const data = await readJsonResponse(await context.pollFetch(taskUrls.getStatusUrl(task.providerTaskId), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
        }), 'Volcengine Seedance poll');
        const url = extractVideoUrl(data);
        return {
            providerId: 'volcengine',
            providerTaskId: task.providerTaskId,
            status: statusFrom(data),
            urls: url ? [url] : [],
            raw: data,
        };
    },
};
