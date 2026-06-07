import { normalizeProviderConfig } from './config.js';
import { ProviderLayerError } from './errors.js';

async function importNodeFs() {
    if (typeof process === 'undefined' || !process.versions?.node) return null;
    return import('node:fs');
}

async function importNodePath() {
    if (typeof process === 'undefined' || !process.versions?.node) return null;
    return import('node:path');
}

function defaultConfigPath() {
    const explicit = process.env.GENAI_PROVIDER_CONFIG_PATH;
    if (explicit) return explicit;
    return '/tmp/.genai/provider-config.json';
}

function parseEnvConfig() {
    const raw = process.env.GENAI_PROVIDER_CONFIG_JSON;
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        throw new ProviderLayerError('provider_config_invalid', 'GENAI_PROVIDER_CONFIG_JSON is not valid JSON');
    }
}

export async function loadServerProviderConfig() {
    const envConfig = parseEnvConfig();
    if (envConfig) return normalizeProviderConfig(envConfig);

    const fs = await importNodeFs();
    if (!fs) return normalizeProviderConfig();
    const configPath = defaultConfigPath();
    try {
        if (!fs.existsSync(configPath)) {
            return normalizeProviderConfig({
                selectedProviderId: process.env.GENAI_DEFAULT_PROVIDER || undefined,
            });
        }
        return normalizeProviderConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } catch (error) {
        throw new ProviderLayerError('provider_config_read_failed', `Failed to read provider config: ${error instanceof Error ? error.message : String(error)}`, {
            configPath,
        });
    }
}

export async function saveServerProviderConfig(config) {
    if (process.env.GENAI_PROVIDER_CONFIG_JSON) {
        throw new ProviderLayerError('provider_config_readonly', 'Provider config is controlled by GENAI_PROVIDER_CONFIG_JSON and cannot be patched at runtime');
    }
    const normalized = normalizeProviderConfig(config);
    const fs = await importNodeFs();
    const path = await importNodePath();
    if (!fs || !path) {
        throw new ProviderLayerError('provider_config_storage_unavailable', 'Server provider config storage is unavailable');
    }
    const configPath = defaultConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

function providerExists(config, providerId) {
    return config.providers.some((provider) => provider.id === providerId);
}

export function applyProviderPatch(currentConfig, patch = {}) {
    const config = normalizeProviderConfig(currentConfig || {});
    const providerId = patch.providerId;

    if (patch.selectedProviderId) {
        if (!providerExists(config, patch.selectedProviderId)) {
            throw new ProviderLayerError('provider_not_found', `Provider ${patch.selectedProviderId} is not configured`, { providerId: patch.selectedProviderId });
        }
        config.selectedProviderId = patch.selectedProviderId;
    }

    if (providerId) {
        if (!providerExists(config, providerId)) {
            throw new ProviderLayerError('provider_not_found', `Provider ${providerId} is not configured`, { providerId });
        }
        config.providers = config.providers.map((provider) => {
            if (provider.id !== providerId) return provider;
            return {
                ...provider,
                ...(typeof patch.baseUrl === 'string' ? { baseUrl: patch.baseUrl.replace(/\/+$/, '') } : {}),
                ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
            };
        });
        if (typeof patch.enabled === 'boolean') {
            config.disabledProviders = patch.enabled
                ? config.disabledProviders.filter((item) => item !== providerId)
                : unique([...config.disabledProviders, providerId]);
        }
    }

    if (patch.disableModel) {
        config.disabledModels = unique([...config.disabledModels, patch.disableModel]);
    }
    if (patch.enableModel) {
        config.disabledModels = config.disabledModels.filter((item) => item !== patch.enableModel);
    }
    if (patch.disableRouteFamily) {
        config.disabledRouteFamilies = unique([...config.disabledRouteFamilies, patch.disableRouteFamily]);
    }
    if (patch.enableRouteFamily) {
        config.disabledRouteFamilies = config.disabledRouteFamilies.filter((item) => item !== patch.enableRouteFamily);
    }
    if (patch.providerDefaults && typeof patch.providerDefaults === 'object') {
        config.providerDefaults = {
            ...config.providerDefaults,
            ...patch.providerDefaults,
        };
    }
    if (patch.assetStorage && typeof patch.assetStorage === 'object') {
        config.assetStorage = {
            ...config.assetStorage,
            ...patch.assetStorage,
            maxBytesByMediaType: {
                ...(config.assetStorage?.maxBytesByMediaType || {}),
                ...(patch.assetStorage.maxBytesByMediaType || {}),
            },
            allowedMimeTypes: {
                ...(config.assetStorage?.allowedMimeTypes || {}),
                ...(patch.assetStorage.allowedMimeTypes || {}),
            },
        };
    }
    if (patch.providerAssetStrategies && typeof patch.providerAssetStrategies === 'object') {
        config.providerAssetStrategies = {
            ...config.providerAssetStrategies,
            ...patch.providerAssetStrategies,
        };
    }

    return normalizeProviderConfig(config);
}

export function enforceServerProviderSelection(requestBody, serverConfig, providerMode = 'server') {
    const config = normalizeProviderConfig(serverConfig || {});
    if (providerMode === 'client') return requestBody;
    return {
        ...requestBody,
        selectedProviderId: config.selectedProviderId,
        providerId: undefined,
        providerOverrideReason: undefined,
    };
}
