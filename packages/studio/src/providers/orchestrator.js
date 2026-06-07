import { loadProviderConfig } from './config.js';
import { createRequestHash } from './idempotency.js';
import { ProviderLayerError, normalizeProviderError } from './errors.js';
import { resolveGenerationTarget } from './feature-router.js';
import { getProviderAdapter } from './registry.js';
import { createInternalTaskId, findTaskByIdempotency, getTask, upsertTask } from './task-store.js';
import { archiveProviderResultUrls } from './assets/result-archive.js';

function defaultFetch(input, init) {
    return fetch(input, init);
}

function createContext(target, credentials = {}, transport = {}) {
    return {
        providerId: target.providerId,
        baseUrl: target.provider.baseUrl,
        apiKey: credentials.apiKey,
        apiKeys: credentials.apiKeys || (credentials.apiKey ? [credentials.apiKey] : []),
        runtime: transport.runtime || 'browser-byok',
        submitFetch: transport.submitFetch || defaultFetch,
        pollFetch: transport.pollFetch || defaultFetch,
        uploadFetch: transport.uploadFetch || defaultFetch,
    };
}

function assertProviderNotKilled(target, config = loadProviderConfig()) {
    if ((config.disabledProviders || []).includes(target.providerId)) {
        throw new ProviderLayerError('provider_disabled', `Provider ${target.providerId} is disabled`, { providerId: target.providerId });
    }
    if ((config.disabledModels || []).includes(`${target.providerId}:${target.modelId}`)) {
        throw new ProviderLayerError('model_disabled', `Model ${target.providerId}:${target.modelId} is disabled`, { providerId: target.providerId, modelId: target.modelId });
    }
}

async function archiveResultUrlsForTask(task, urls, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
        return { records: [], stableUrls: [] };
    }
    return archiveProviderResultUrls({
        task,
        urls,
        fetchImpl: options.transport?.archiveFetch || options.transport?.pollFetch || options.transport?.submitFetch || defaultFetch,
    }, options.config || loadProviderConfig());
}

export async function submitGenerationRequest(request, options = {}) {
    const config = options.config || loadProviderConfig();
    const requestHash = createRequestHash(request);
    const idempotencyKey = request.idempotencyKey || options.idempotencyKey || null;
    const existing = findTaskByIdempotency(idempotencyKey, requestHash);
    if (existing) {
        return {
            providerId: existing.providerId,
            taskId: existing.internalTaskId,
            providerTaskId: existing.providerTaskId,
            status: existing.status,
            urls: existing.resultUrls || [],
            reused: true,
        };
    }

    const target = resolveGenerationTarget(request, { allowProviderOverride: options.allowProviderOverride, config });
    assertProviderNotKilled(target, config);
    const adapter = getProviderAdapter(target.providerId);
    const plan = adapter.buildRequestPlan({
        ...request,
        providerId: target.providerId,
        modelId: target.modelId,
        mediaType: target.mediaType,
        operation: target.operation,
    });
    if ((config.disabledRouteFamilies || []).includes(`${target.providerId}:${plan.family}`)) {
        throw new ProviderLayerError('route_family_disabled', `Route family ${target.providerId}:${plan.family} is disabled`, {
            providerId: target.providerId,
            family: plan.family,
        });
    }

    const internalTaskId = createInternalTaskId(target.providerId);
    upsertTask({
        internalTaskId,
        providerId: target.providerId,
        providerTaskId: null,
        mediaType: target.mediaType,
        operation: target.operation,
        modelId: target.modelId,
        requestHash,
        idempotencyKey,
        status: 'queued',
        submitStartedAt: new Date().toISOString(),
        requestPlan: {
            family: plan.family,
            endpointPath: plan.endpointPath,
            polling: plan.polling,
        },
    });

    try {
        const result = await adapter.submit(plan, createContext(target, options.credentials, options.transport));
        const status = result.status || (result.providerTaskId ? 'queued' : 'succeeded');
        const archive = status === 'succeeded'
            ? await archiveResultUrlsForTask({
                internalTaskId,
                providerId: target.providerId,
                mediaType: target.mediaType,
                operation: target.operation,
                modelId: target.modelId,
            }, result.urls || [], { ...options, config })
            : { records: [], stableUrls: [] };
        upsertTask({
            internalTaskId,
            providerId: target.providerId,
            providerTaskId: result.providerTaskId,
            mediaType: target.mediaType,
            operation: target.operation,
            modelId: target.modelId,
            requestHash,
            idempotencyKey,
            status,
            submitFinishedAt: new Date().toISOString(),
            resultUrls: result.urls || [],
            resultAssetIds: archive.records.map((asset) => asset.assetId),
            stableResultUrls: archive.stableUrls,
            resultArchiveStatus: archive.records.length > 0
                ? (archive.stableUrls.length === archive.records.length ? 'archived' : 'pending_storage')
                : 'not_started',
            rawRef: result.raw ? { stored: true } : null,
        });
        return {
            providerId: target.providerId,
            taskId: internalTaskId,
            providerTaskId: result.providerTaskId,
            status,
            urls: result.urls || [],
            stableUrls: archive.stableUrls,
            resultAssetIds: archive.records.map((asset) => asset.assetId),
            resultArchiveStatus: archive.records.length > 0
                ? (archive.stableUrls.length === archive.records.length ? 'archived' : 'pending_storage')
                : 'not_started',
            raw: result.raw,
        };
    } catch (error) {
        const normalized = normalizeProviderError(error);
        upsertTask({
            internalTaskId,
            providerId: target.providerId,
            providerTaskId: null,
            mediaType: target.mediaType,
            operation: target.operation,
            modelId: target.modelId,
            requestHash,
            idempotencyKey,
            status: 'failed',
            errorCode: normalized.code,
            errorMessage: normalized.message,
        });
        throw error;
    }
}

export async function pollGenerationTask(internalTaskId, options = {}) {
    const config = options.config || loadProviderConfig();
    const task = getTask(internalTaskId);
    if (!task) {
        throw new ProviderLayerError('task_not_found', `Task ${internalTaskId} was not found`, { internalTaskId });
    }
    if (options.provider?.id && options.provider.id !== task.providerId) {
        throw new ProviderLayerError('provider_mismatch', 'Polling provider must match the submitted task provider', {
            requestedProviderId: options.provider.id,
            taskProviderId: task.providerId,
        });
    }
    if (!task.providerTaskId) {
        return {
            providerId: task.providerId,
            taskId: internalTaskId,
            status: task.status,
            urls: task.resultUrls || [],
            stableUrls: task.stableResultUrls || [],
            resultAssetIds: task.resultAssetIds || [],
            resultArchiveStatus: task.resultArchiveStatus || 'not_started',
        };
    }
    const target = {
        providerId: task.providerId,
        provider: options.provider || config.providers.find((item) => item.id === task.providerId) || { baseUrl: '' },
    };
    const adapter = getProviderAdapter(task.providerId);
    const result = await adapter.poll(task, createContext(target, options.credentials, options.transport));
    const archive = result.status === 'succeeded'
        ? await archiveResultUrlsForTask(task, result.urls || [], { ...options, config })
        : { records: [], stableUrls: [] };
    upsertTask({
        ...task,
        status: result.status,
        lastPollAt: new Date().toISOString(),
        completedAt: result.status === 'succeeded' || result.status === 'failed' ? new Date().toISOString() : task.completedAt,
        resultUrls: result.urls || [],
        resultAssetIds: archive.records.length > 0 ? archive.records.map((asset) => asset.assetId) : task.resultAssetIds,
        stableResultUrls: archive.records.length > 0 ? archive.stableUrls : task.stableResultUrls,
        resultArchiveStatus: archive.records.length > 0
            ? (archive.stableUrls.length === archive.records.length ? 'archived' : 'pending_storage')
            : (task.resultArchiveStatus || 'not_started'),
    });
    return {
        providerId: task.providerId,
        taskId: internalTaskId,
        providerTaskId: task.providerTaskId,
        status: result.status,
        urls: result.urls || [],
        stableUrls: archive.records.length > 0 ? archive.stableUrls : (task.stableResultUrls || []),
        resultAssetIds: archive.records.length > 0 ? archive.records.map((asset) => asset.assetId) : (task.resultAssetIds || []),
        resultArchiveStatus: archive.records.length > 0
            ? (archive.stableUrls.length === archive.records.length ? 'archived' : 'pending_storage')
            : (task.resultArchiveStatus || 'not_started'),
        raw: result.raw,
    };
}
