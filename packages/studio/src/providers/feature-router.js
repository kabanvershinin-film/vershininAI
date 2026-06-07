import { getFeatureKeyForRequest, getProviderById, loadProviderConfig } from './config.js';
import { ProviderLayerError } from './errors.js';
import { getModelRecord, inferMediaTypeForRequest } from './model-inventory.js';

function parseBinding(binding) {
    if (typeof binding !== 'string') return null;
    const index = binding.indexOf(':');
    if (index <= 0) return null;
    return {
        providerId: binding.slice(0, index),
        modelId: binding.slice(index + 1),
    };
}

function firstBinding(bindings) {
    if (!Array.isArray(bindings) || bindings.length === 0) return null;
    return parseBinding(bindings[0]);
}

function isProviderDisabled(providerId, config) {
    return (config.disabledProviders || []).includes(providerId);
}

function isModelDisabled(providerId, modelId, config) {
    return (config.disabledModels || []).includes(`${providerId}:${modelId}`);
}

function assertNoSilentFallback({ selectedProviderId, resolvedProviderId, feature, override }) {
    if (resolvedProviderId === selectedProviderId) return;
    if (override) return;
    throw new ProviderLayerError(
        'silent_provider_fallback_forbidden',
        `Feature ${feature} resolved to ${resolvedProviderId} while selected provider is ${selectedProviderId}. Silent provider fallback is forbidden.`,
        { selectedProviderId, resolvedProviderId, feature }
    );
}

export function resolveGenerationTarget(request, options = {}) {
    const config = options.config || loadProviderConfig();
    const feature = getFeatureKeyForRequest(request);
    const mediaType = inferMediaTypeForRequest(request);
    const explicitOverride = config.explicitFeatureOverrides?.[feature] || null;
    const selectedProviderId = request.providerId && options.allowProviderOverride
        ? request.providerId
        : request.selectedProviderId || config.selectedProviderId;

    let providerId = selectedProviderId;
    let modelId = request.modelId;
    let overrideReason = null;

    if (explicitOverride) {
        const binding = firstBinding(explicitOverride.bindings);
        if (binding) {
            providerId = binding.providerId;
            modelId = modelId || binding.modelId;
            overrideReason = explicitOverride.reason || 'explicit override';
        }
    } else if (!modelId) {
        const providerBindings = config.providerDefaults?.[selectedProviderId]?.[feature];
        const binding = firstBinding(providerBindings);
        if (binding) {
            providerId = binding.providerId;
            modelId = binding.modelId;
        }
    }

    assertNoSilentFallback({
        selectedProviderId,
        resolvedProviderId: providerId,
        feature,
        override: explicitOverride,
    });

    if (!providerId) {
        throw new ProviderLayerError('provider_unconfigured', `No provider configured for ${feature}`, { feature });
    }
    if (!modelId && !explicitOverride) {
        throw new ProviderLayerError('model_unconfigured', `No model configured for ${feature} under ${providerId}`, { feature, providerId });
    }
    if (isProviderDisabled(providerId, config)) {
        throw new ProviderLayerError('provider_disabled', `Provider ${providerId} is disabled`, { providerId });
    }
    if (modelId && isModelDisabled(providerId, modelId, config)) {
        throw new ProviderLayerError('model_disabled', `Model ${providerId}:${modelId} is disabled`, { providerId, modelId });
    }

    const provider = getProviderById(providerId, config);
    if (!provider) {
        throw new ProviderLayerError('provider_not_found', `Provider ${providerId} is not configured`, { providerId });
    }

    const modelRecord = modelId ? getModelRecord(providerId, modelId) : null;
    if (modelRecord?.mediaTypes?.includes('unknown')) {
        throw new ProviderLayerError('unknown_model_not_executable', `Model ${providerId}:${modelId} is not classified and cannot execute`, { providerId, modelId });
    }

    return {
        providerId,
        modelId,
        mediaType,
        operation: request.operation,
        feature,
        provider,
        modelRecord,
        overrideReason,
    };
}

export function getSelectedProvider() {
    return loadProviderConfig().selectedProviderId;
}
