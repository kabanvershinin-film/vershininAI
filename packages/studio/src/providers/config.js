import { featureKey, inferMediaTypeFromOperation } from './types.js';

export const PROVIDER_CONFIG_STORAGE_KEY = 'genai_provider_config';
export const LEGACY_MUAPI_STORAGE_KEY = 'muapi_key';

const DEFAULT_CONFIG = Object.freeze({
    schemaVersion: 5,
    selectedProviderId: 'memefast',
    providerSwitchMode: 'global',
    allowSilentProviderFallback: false,
    providers: [
        {
            id: 'muapi',
            platform: 'muapi',
            name: 'MuAPI',
            baseUrl: 'https://api.muapi.ai',
            apiKeyStorageRef: 'byok:muapi',
            enabled: true,
        },
        {
            id: 'memefast',
            platform: 'memefast',
            name: 'MemeFast',
            baseUrl: 'https://memefast.top',
            apiKeyStorageRef: 'byok:memefast',
            enabled: true,
        },
        {
            id: 'volcengine',
            platform: 'volcengine',
            name: 'Volcengine Ark',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            apiKeyStorageRef: 'byok:volcengine',
            enabled: true,
            models: [
                'doubao-seedance-2-0-260128',
                'doubao-seedance-2-0-fast-260128',
            ],
        },
    ],
    providerDefaults: {
        memefast: {
            'text:chat': ['memefast:gemini-3.1-pro-preview'],
            'text:responses': ['memefast:gemini-3.1-pro-preview'],
            'text:analysis': ['memefast:gemini-3.1-pro-preview'],
            'image:t2i': ['memefast:doubao-seedream-5-0-260128'],
            'image:i2i': ['memefast:doubao-seedream-5-0-260128'],
            'video:t2v': ['memefast:sora-2'],
            'video:i2v': ['memefast:sora-2'],
            'video:v2v': ['memefast:kling-v3.0-pro-motion-control'],
            'video:lipsync': ['memefast:wan2.2-speech-to-video'],
            'audio:music': ['memefast:suno_music'],
            'audio:tts': ['memefast:tts-1'],
        },
        muapi: {},
        volcengine: {
            'video:t2v': ['volcengine:doubao-seedance-2-0-260128'],
            'video:i2v': ['volcengine:doubao-seedance-2-0-260128'],
        },
    },
    explicitFeatureOverrides: {
        'workflow:workflow_run': {
            bindings: ['muapi:workflow'],
            reason: 'muapi-only capability',
        },
        'agent:agent_chat': {
            bindings: ['muapi:agent'],
            reason: 'muapi-only capability',
        },
        'app:app': {
            bindings: ['muapi:app'],
            reason: 'muapi-only capability',
        },
    },
    disabledProviders: [],
    disabledModels: [],
    disabledRouteFamilies: [],
    assetStorage: {
        mode: 'disabled',
        publicBaseUrl: '',
        localPublicDir: 'public/generated-assets',
        localPublicPath: '/generated-assets',
        maxBytesByMediaType: {
            image: 20 * 1024 * 1024,
            video: 512 * 1024 * 1024,
            audio: 100 * 1024 * 1024,
        },
        allowedMimeTypes: {
            image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
            video: ['video/mp4', 'video/webm', 'video/quicktime'],
            audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'],
        },
    },
    providerAssetStrategies: {
        muapi: {
            inputUpload: 'provider_native_upload',
            resultArchive: 'object_storage_url',
        },
        memefast: {
            inputUpload: 'object_storage_url',
            resultArchive: 'object_storage_url',
        },
        volcengine: {
            inputUpload: 'object_storage_url',
            resultArchive: 'object_storage_url',
        },
    },
});

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function canUseLocalStorage() {
    return typeof window !== 'undefined' && window.localStorage;
}

function readByokKey(providerId) {
    if (!canUseLocalStorage()) return '';
    if (providerId === 'muapi') {
        return localStorage.getItem(LEGACY_MUAPI_STORAGE_KEY) || localStorage.getItem('genai_key_muapi') || '';
    }
    return localStorage.getItem(`genai_key_${providerId}`) || '';
}

export function getProviderApiKey(providerId) {
    return readByokKey(providerId);
}

export function normalizeProviderConfig(rawConfig = {}) {
    const rawSchemaVersion = Number(rawConfig?.schemaVersion || 0);
    const config = {
        ...deepClone(DEFAULT_CONFIG),
        ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}),
    };
    config.schemaVersion = DEFAULT_CONFIG.schemaVersion;
    config.providerSwitchMode = 'global';
    config.allowSilentProviderFallback = false;
    config.providers = Array.isArray(config.providers) && config.providers.length > 0
        ? config.providers
        : deepClone(DEFAULT_CONFIG.providers);
    const providerById = new Map(config.providers.map((provider) => [provider.id, provider]));
    for (const defaultProvider of DEFAULT_CONFIG.providers) {
        const existing = providerById.get(defaultProvider.id);
        if (!existing) {
            config.providers.push(deepClone(defaultProvider));
        } else {
            Object.assign(existing, {
                platform: existing.platform || defaultProvider.platform,
                name: existing.name || defaultProvider.name,
                baseUrl: existing.baseUrl || defaultProvider.baseUrl,
                apiKeyStorageRef: existing.apiKeyStorageRef || defaultProvider.apiKeyStorageRef,
                enabled: existing.enabled !== undefined ? existing.enabled : defaultProvider.enabled,
                models: Array.isArray(existing.models) && existing.models.length > 0
                    ? existing.models
                    : (defaultProvider.models ? [...defaultProvider.models] : existing.models),
            });
        }
    }
    config.providerDefaults = {
        ...(DEFAULT_CONFIG.providerDefaults || {}),
        ...(config.providerDefaults || {}),
    };
    config.explicitFeatureOverrides = {
        ...(DEFAULT_CONFIG.explicitFeatureOverrides || {}),
        ...(config.explicitFeatureOverrides || {}),
    };
    config.disabledProviders = Array.isArray(config.disabledProviders) ? config.disabledProviders : [];
    config.disabledModels = Array.isArray(config.disabledModels) ? config.disabledModels : [];
    config.disabledRouteFamilies = Array.isArray(config.disabledRouteFamilies) ? config.disabledRouteFamilies : [];
    config.assetStorage = {
        ...deepClone(DEFAULT_CONFIG.assetStorage),
        ...(config.assetStorage || {}),
        maxBytesByMediaType: {
            ...deepClone(DEFAULT_CONFIG.assetStorage.maxBytesByMediaType),
            ...(config.assetStorage?.maxBytesByMediaType || {}),
        },
        allowedMimeTypes: {
            ...deepClone(DEFAULT_CONFIG.assetStorage.allowedMimeTypes),
            ...(config.assetStorage?.allowedMimeTypes || {}),
        },
    };
    config.providerAssetStrategies = {
        ...deepClone(DEFAULT_CONFIG.providerAssetStrategies),
        ...(config.providerAssetStrategies || {}),
    };
    if (!config.selectedProviderId) config.selectedProviderId = 'memefast';
    if (rawSchemaVersion < 4 && config.selectedProviderId === 'muapi') {
        config.selectedProviderId = 'memefast';
    }
    return config;
}

export function loadProviderConfig() {
    if (!canUseLocalStorage()) return normalizeProviderConfig();
    const stored = safeJsonParse(localStorage.getItem(PROVIDER_CONFIG_STORAGE_KEY));
    const config = normalizeProviderConfig(stored || {});
    const legacyMuapiKey = localStorage.getItem(LEGACY_MUAPI_STORAGE_KEY);
    if (legacyMuapiKey && !localStorage.getItem('genai_key_muapi')) {
        localStorage.setItem('genai_key_muapi', legacyMuapiKey);
    }
    return config;
}

export function saveProviderConfig(config) {
    const normalized = normalizeProviderConfig(config);
    if (canUseLocalStorage()) {
        localStorage.setItem(PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
}

export function getProviderConfigSnapshot(config = loadProviderConfig()) {
    const normalized = normalizeProviderConfig(config);
    return {
        ...normalized,
        providers: normalized.providers.map((provider) => ({
            ...provider,
            apiKey: undefined,
            apiKeys: undefined,
            hasApiKey: Boolean(readByokKey(provider.id)),
        })),
    };
}

export function getProviderById(providerId, config = loadProviderConfig()) {
    const normalized = normalizeProviderConfig(config);
    return normalized.providers.find((provider) => provider.id === providerId) || null;
}

export function getBrowserProviderCredentials(providerId) {
    const key = readByokKey(providerId);
    return key ? { apiKey: key, apiKeys: key.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) } : {};
}

export function setSelectedProvider(providerId) {
    const config = loadProviderConfig();
    const next = saveProviderConfig({ ...config, selectedProviderId: providerId });
    return next;
}

export function getFeatureKeyForRequest(request) {
    const mediaType = request.mediaType || inferMediaTypeFromOperation(request.operation);
    return featureKey(mediaType, request.operation);
}

export function setProviderApiKey(providerId, apiKey) {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(`genai_key_${providerId}`, apiKey || '');
    if (providerId === 'muapi') {
        localStorage.setItem(LEGACY_MUAPI_STORAGE_KEY, apiKey || '');
    }
}
