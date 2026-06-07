import {
    audioModels,
    getAudioModelById,
    getI2IModelById,
    getI2VModelById,
    getLipSyncModelById,
    getModelById,
    getV2VModelById,
    getVideoModelById,
    i2iModels,
    i2vModels,
    lipsyncModels,
    t2iModels,
    t2vModels,
    v2vModels,
} from '../models.js';
import {
    getMemefastFamilyManifest,
    inferMemefastFamily,
    normalizeMemefastModelId,
} from './memefast/capabilities.js';
import { inferMediaTypeFromOperation } from './types.js';

export const MODEL_SNAPSHOT_STORAGE_KEY = 'genai_model_inventory_snapshot_v1';

function nowIso() {
    return new Date().toISOString();
}

function canUseLocalStorage() {
    return typeof window !== 'undefined' && window.localStorage;
}

function memorySnapshotStore() {
    if (!globalThis.__GENAI_MODEL_INVENTORY_SNAPSHOT__) {
        globalThis.__GENAI_MODEL_INVENTORY_SNAPSHOT__ = {};
    }
    return globalThis.__GENAI_MODEL_INVENTORY_SNAPSHOT__;
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function createModelRecord({ providerId, modelId, mediaTypes, capabilities = [], endpointTypes = [], routeFamilies = {}, source = [], raw = {} }) {
    const seenAt = nowIso();
    return {
        providerId,
        modelId,
        displayName: raw.name || raw.displayName || modelId,
        mediaTypes: Array.from(new Set(mediaTypes.length > 0 ? mediaTypes : ['unknown'])),
        capabilities: Array.from(new Set(capabilities)),
        endpointTypes: Array.from(new Set(endpointTypes)),
        routeFamilies,
        pricing: raw.pricing || {},
        limits: raw.limits || {},
        source: Array.from(new Set(source)),
        visibility: {
            currentKeys: 'unknown',
            visibleKeyRefs: [],
            enableGroups: [],
            lastSeenAt: seenAt,
            staleSince: null,
        },
        lifecycle: {
            state: 'active',
            explicitRemovedAt: null,
        },
        raw,
    };
}

function mergeModelRecord(existing, incoming) {
    const lastSeenAt = incoming.visibility?.lastSeenAt || nowIso();
    return {
        ...(existing || {}),
        ...incoming,
        mediaTypes: Array.from(new Set([...(existing?.mediaTypes || []), ...(incoming.mediaTypes || [])])),
        capabilities: Array.from(new Set([...(existing?.capabilities || []), ...(incoming.capabilities || [])])),
        endpointTypes: Array.from(new Set([...(existing?.endpointTypes || []), ...(incoming.endpointTypes || [])])),
        source: Array.from(new Set([...(existing?.source || []), ...(incoming.source || [])])),
        routeFamilies: {
            ...(existing?.routeFamilies || {}),
            ...(incoming.routeFamilies || {}),
        },
        visibility: {
            ...(existing?.visibility || {}),
            ...(incoming.visibility || {}),
            currentKeys: incoming.visibility?.currentKeys || existing?.visibility?.currentKeys || 'unknown',
            lastSeenAt,
            staleSince: null,
        },
        lifecycle: {
            ...(existing?.lifecycle || {}),
            state: 'active',
            explicitRemovedAt: existing?.lifecycle?.explicitRemovedAt || null,
        },
        raw: {
            ...(existing?.raw || {}),
            ...(incoming.raw || {}),
        },
    };
}

export function loadModelSnapshot() {
    if (!canUseLocalStorage()) return memorySnapshotStore();
    return safeJsonParse(localStorage.getItem(MODEL_SNAPSHOT_STORAGE_KEY)) || {};
}

export function saveModelSnapshot(snapshot) {
    if (canUseLocalStorage()) {
        localStorage.setItem(MODEL_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
        globalThis.__GENAI_MODEL_INVENTORY_SNAPSHOT__ = snapshot || {};
    }
    return snapshot;
}

export function mergeModelInventory(providerId, incomingRecords, previousSnapshot = loadModelSnapshot()) {
    const nextSnapshot = { ...(previousSnapshot || {}) };
    const providerRecords = { ...(nextSnapshot[providerId] || {}) };
    const seen = new Set();

    for (const incoming of incomingRecords) {
        if (!incoming?.modelId) continue;
        seen.add(incoming.modelId);
        providerRecords[incoming.modelId] = mergeModelRecord(providerRecords[incoming.modelId], incoming);
    }

    for (const [modelId, record] of Object.entries(providerRecords)) {
        if (seen.has(modelId)) continue;
        if (record.lifecycle?.state === 'tombstoned') continue;
        providerRecords[modelId] = {
            ...record,
            visibility: {
                ...(record.visibility || {}),
                currentKeys: record.visibility?.currentKeys === 'visible' ? 'not_visible' : (record.visibility?.currentKeys || 'unknown'),
                staleSince: record.visibility?.staleSince || nowIso(),
            },
            lifecycle: {
                ...(record.lifecycle || {}),
                state: 'stale',
            },
        };
    }

    nextSnapshot[providerId] = providerRecords;
    return nextSnapshot;
}

export function buildLegacyMuapiInventory() {
    const records = [];
    const pushIf = (model, mediaType, capability, endpointType) => {
        if (!model?.id) return;
        records.push(createModelRecord({
            providerId: 'muapi',
            modelId: model.id,
            mediaTypes: [mediaType],
            capabilities: [capability],
            endpointTypes: [endpointType || model.endpoint || model.id],
            source: ['legacy-muapi', 'static-default'],
            raw: model,
        }));
    };

    for (const operation of [
        ['nano-banana', getModelById, 'image', 'image_generation', 't2i'],
        ['flux-dev', getModelById, 'image', 'image_generation', 't2i'],
        ['sora-2', getVideoModelById, 'video', 'video_generation', 't2v'],
    ]) {
        const [id, getter, mediaType, capability, endpointType] = operation;
        pushIf(getter(id), mediaType, capability, endpointType);
    }

    for (const [id, getter, mediaType, capability, endpointType] of [
        ['nano-banana', getI2IModelById, 'image', 'image_generation', 'i2i'],
        ['sora-2', getI2VModelById, 'video', 'video_generation', 'i2v'],
        ['mmaudio-v2-text-to-audio', getAudioModelById, 'audio', 'audio_generation', 'music'],
    ]) {
        pushIf(getter(id), mediaType, capability, endpointType);
    }

    return records;
}

const MEMEFAST_TEXT_MODELS = Object.freeze([
    {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro Preview',
        supported_endpoint_types: ['chat', 'responses', 'analysis', 'vision'],
    },
    {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview',
        supported_endpoint_types: ['chat', 'responses', 'analysis', 'vision'],
    },
    {
        id: 'gemini-3-pro-preview-thinking',
        name: 'Gemini 3 Pro Preview Thinking',
        supported_endpoint_types: ['chat', 'responses', 'analysis', 'vision'],
    },
    {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        supported_endpoint_types: ['chat', 'analysis'],
    },
    {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        supported_endpoint_types: ['chat', 'analysis'],
    },
    {
        id: 'deepseek-v3.2',
        name: 'DeepSeek V3.2',
        supported_endpoint_types: ['chat', 'analysis'],
    },
    {
        id: 'glm-5',
        name: 'GLM-5',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'glm-4.7',
        name: 'GLM-4.7',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        supported_endpoint_types: ['chat', 'analysis', 'vision'],
    },
    {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        supported_endpoint_types: ['chat', 'responses', 'analysis', 'vision'],
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        supported_endpoint_types: ['chat', 'responses', 'analysis'],
    },
    {
        id: 'deepseek-v3.1',
        name: 'DeepSeek V3.1',
        supported_endpoint_types: ['chat', 'analysis'],
    },
    {
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        supported_endpoint_types: ['chat', 'analysis'],
    },
]);

const STATIC_MEMEFAST_MODEL_GROUPS = Object.freeze([
    { mediaType: 'image', operation: 't2i', capability: 'image_generation', models: t2iModels },
    { mediaType: 'image', operation: 'i2i', capability: 'image_generation', models: i2iModels },
    { mediaType: 'video', operation: 't2v', capability: 'video_generation', models: t2vModels },
    { mediaType: 'video', operation: 'i2v', capability: 'video_generation', models: i2vModels },
    { mediaType: 'video', operation: 'v2v', capability: 'video_generation', models: v2vModels },
    { mediaType: 'video', operation: 'lipsync', capability: 'video_generation', models: lipsyncModels },
    { mediaType: 'audio', operation: 'music', capability: 'audio_generation', models: audioModels },
    { mediaType: 'text', operation: 'chat', capability: 'text_generation', models: MEMEFAST_TEXT_MODELS },
]);

function buildMemefastRouteFamily(model, mediaType, operation) {
    const family = inferMemefastFamily({ mediaType, modelId: model.id, operation });
    if (!family) return null;
    const providerModelId = normalizeMemefastModelId(model.id, mediaType, family);
    const manifest = getMemefastFamilyManifest(mediaType, family);
    return {
        family,
        providerModelId,
        mediaType,
        operation,
        adapter: manifest?.adapter || null,
        supportsBase64: manifest?.supportsBase64 ?? null,
        requiresHostedUrl: manifest?.requiresHostedUrl ?? null,
        officialCapabilityStatus: manifest?.officialCapabilityStatus || 'unknown',
    };
}

export function buildStaticMemefastInventory() {
    const records = [];
    for (const group of STATIC_MEMEFAST_MODEL_GROUPS) {
        for (const model of group.models || []) {
            if (!model?.id) continue;
            const routeFamily = buildMemefastRouteFamily(model, group.mediaType, group.operation);
            if (!routeFamily) continue;
            records.push(createModelRecord({
                providerId: 'memefast',
                modelId: model.id,
                mediaTypes: [group.mediaType],
                capabilities: [group.capability],
                endpointTypes: [group.operation],
                routeFamilies: {
                    [group.operation]: routeFamily,
                },
                source: ['static-ui', 'moyin-family-manifest'],
                raw: {
                    ...model,
                    providerModelId: routeFamily.providerModelId,
                    memefastFamily: routeFamily.family,
                    sourceOperation: group.operation,
                },
            }));
        }
    }
    return records;
}

function inferMediaTypesForModel(model) {
    const endpointTypes = model.supported_endpoint_types || model.endpointTypes || [];
    const modelType = String(model.model_type || model.type || '').toLowerCase();
    const id = String(model.id || model.model || model.name || '').toLowerCase();
    const joined = `${modelType} ${id} ${Array.isArray(endpointTypes) ? endpointTypes.join(' ') : ''}`.toLowerCase();
    const types = new Set();
    if (/image|t2i|i2i|vision|图片|图像/.test(joined)) types.add('image');
    if (/video|t2v|i2v|视频|vidu|sora|seedance|kling/.test(joined)) types.add('video');
    if (/audio|music|tts|voice|suno|音频|语音|音乐/.test(joined)) types.add('audio');
    if (/chat|text|llm|gemini|gpt|claude|deepseek|文本|对话/.test(joined)) types.add('text');
    if (types.size === 0) types.add('unknown');
    return Array.from(types);
}

export function buildProviderInventoryFromModels(providerId, models, source) {
    if (!Array.isArray(models)) return [];
    return models.map((model) => {
        const modelId = typeof model === 'string'
            ? model
            : (model.id || model.model || model.name);
        const endpointTypes = Array.isArray(model.supported_endpoint_types)
            ? model.supported_endpoint_types
            : Array.isArray(model.endpointTypes)
                ? model.endpointTypes
                : [];
        const mediaTypes = inferMediaTypesForModel({ ...model, id: modelId, endpointTypes });
        return createModelRecord({
            providerId,
            modelId,
            mediaTypes,
            capabilities: mediaTypes.filter((type) => type !== 'unknown').map((type) => `${type}_generation`),
            endpointTypes,
            source,
            raw: model,
        });
    }).filter((record) => record.modelId);
}

export function summarizeInventory(snapshot) {
    const summary = {};
    for (const [providerId, records] of Object.entries(snapshot || {})) {
        const byMediaType = {};
        const values = Object.values(records || {});
        for (const record of values) {
            for (const mediaType of record.mediaTypes || ['unknown']) {
                byMediaType[mediaType] = (byMediaType[mediaType] || 0) + 1;
            }
        }
        summary[providerId] = { total: values.length, byMediaType };
    }
    return summary;
}

export function assertNoModelRetentionLoss(beforeSummary, afterSummary, explicitlyRemoved = {}) {
    for (const [providerId, beforeProvider] of Object.entries(beforeSummary || {})) {
        const afterProvider = afterSummary?.[providerId] || { total: 0, byMediaType: {} };
        const removedProvider = explicitlyRemoved?.[providerId] || { total: 0, byMediaType: {} };
        if (afterProvider.total < beforeProvider.total - (removedProvider.total || 0)) {
            throw new Error(`Model retention loss for ${providerId}: ${beforeProvider.total} -> ${afterProvider.total}`);
        }
        for (const [mediaType, beforeCount] of Object.entries(beforeProvider.byMediaType || {})) {
            const afterCount = afterProvider.byMediaType?.[mediaType] || 0;
            const removedCount = removedProvider.byMediaType?.[mediaType] || 0;
            if (afterCount < beforeCount - removedCount) {
                throw new Error(`Model retention loss for ${providerId}/${mediaType}: ${beforeCount} -> ${afterCount}`);
            }
        }
    }
}

export function getModelRecord(providerId, modelId, snapshot = loadModelSnapshot()) {
    return snapshot?.[providerId]?.[modelId] || null;
}

export function inferMediaTypeForRequest(request) {
    return request.mediaType || inferMediaTypeFromOperation(request.operation);
}
