import { muapiAdapter } from './muapi/adapter.js';
import { memefastAdapter } from './memefast/adapter.js';
import { volcengineAdapter } from './volcengine/adapter.js';
import { ProviderLayerError } from './errors.js';

const ADAPTERS = Object.freeze({
    muapi: muapiAdapter,
    memefast: memefastAdapter,
    volcengine: volcengineAdapter,
});

export function getProviderAdapter(providerId) {
    const adapter = ADAPTERS[providerId];
    if (!adapter) {
        throw new ProviderLayerError('provider_adapter_missing', `No provider adapter registered for ${providerId}`, { providerId });
    }
    return adapter;
}

export function listProviderAdapters() {
    return Object.values(ADAPTERS).map((adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        capabilities: adapter.capabilities || [],
    }));
}
