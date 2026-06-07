import { loadProviderConfig } from '../config.js';
import { ProviderLayerError } from '../errors.js';
import { createAssetId, upsertAsset } from './asset-store.js';
import { assertSafeExternalAssetUrl } from './url-safety.js';

function providerAssetStrategy(providerId, config) {
    return config.providerAssetStrategies?.[providerId] || {};
}

function storageMode(config) {
    return config.assetStorage?.mode || 'disabled';
}

function isInlineDisplayAssetUrl(url) {
    return typeof url === 'string' && /^data:(image|video|audio)\//i.test(url);
}

function extensionFromUrl(url, mediaType) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        const match = pathname.match(/\.[a-z0-9]+$/);
        if (match) return match[0];
    } catch {
        // assertSafeExternalAssetUrl handles invalid URLs before this helper matters.
    }
    if (mediaType === 'video') return '.mp4';
    if (mediaType === 'audio') return '.mp3';
    return '.png';
}

export async function archiveProviderResultUrls({ task, urls, fetchImpl = fetch }, config = loadProviderConfig()) {
    const strategy = providerAssetStrategy(task.providerId, config);
    const records = [];
    const stableUrls = [];

    for (const url of urls || []) {
        if (isInlineDisplayAssetUrl(url)) {
            continue;
        }
        const safeUrl = assertSafeExternalAssetUrl(url, {
            providerId: task.providerId,
            taskId: task.internalTaskId,
            mediaType: task.mediaType,
        });
        const assetId = createAssetId(task.providerId, task.mediaType);
        const mode = storageMode(config);

        if (strategy.resultArchive !== 'object_storage_url') {
            throw new ProviderLayerError('provider_result_archive_unsupported', `Provider ${task.providerId} does not support result archiving`, {
                providerId: task.providerId,
            });
        }

        if (mode === 'disabled') {
            records.push(upsertAsset({
                assetId,
                taskId: task.internalTaskId,
                providerId: task.providerId,
                modelId: task.modelId || null,
                mediaType: task.mediaType,
                purpose: 'generation_result',
                source: 'provider_result',
                status: 'provider_url_validated',
                archiveStatus: 'pending_storage',
                originalProviderUrl: safeUrl,
                url: null,
                createdAt: new Date().toISOString(),
            }));
            continue;
        }

        if (mode !== 'local_public') {
            throw new ProviderLayerError('asset_storage_adapter_missing', `Asset storage mode ${mode} is not implemented`, { mode });
        }

        const response = await fetchImpl(safeUrl, { redirect: 'manual' });
        if (!response.ok) {
            throw new ProviderLayerError('result_archive_fetch_failed', `Failed to fetch provider result: ${response.status}`, {
                providerId: task.providerId,
                status: response.status,
            });
        }

        const storageKey = `${assetId}${extensionFromUrl(safeUrl, task.mediaType)}`;
        const publicBaseUrl = (config.assetStorage?.publicBaseUrl || '').replace(/\/+$/, '');
        const localPublicPath = config.assetStorage?.localPublicPath || '/generated-assets';
        if (!publicBaseUrl) {
            throw new ProviderLayerError('asset_storage_unconfigured', 'Asset storage publicBaseUrl is required for archived result URLs', { mode });
        }
        const archivedUrl = assertSafeExternalAssetUrl(`${publicBaseUrl}${localPublicPath}/${encodeURIComponent(storageKey)}`, {
            providerId: task.providerId,
            taskId: task.internalTaskId,
        });
        records.push(upsertAsset({
            assetId,
            taskId: task.internalTaskId,
            providerId: task.providerId,
            modelId: task.modelId || null,
            mediaType: task.mediaType,
            purpose: 'generation_result',
            source: 'provider_result',
            status: 'ready',
            archiveStatus: 'archived',
            originalProviderUrl: safeUrl,
            storageMode: mode,
            storageKey,
            url: archivedUrl,
            createdAt: new Date().toISOString(),
        }));
        stableUrls.push(archivedUrl);
    }

    return { records, stableUrls };
}
