import { loadProviderConfig } from '../config.js';
import { ProviderLayerError } from '../errors.js';
import { createAssetId, upsertAsset } from './asset-store.js';
import { assertSafeExternalAssetUrl } from './url-safety.js';

const EXTENSIONS_BY_MEDIA_TYPE = Object.freeze({
    image: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    video: ['.mp4', '.webm', '.mov'],
    audio: ['.mp3', '.wav', '.webm', '.ogg', '.m4a', '.mp4'],
});

function extensionFromName(fileName = '') {
    const match = String(fileName).toLowerCase().match(/\.[^.]+$/);
    return match ? match[0] : '';
}

function assertUploadMetadataAllowed({ mediaType, fileName, contentType, sizeBytes }, config) {
    const maxBytes = config.assetStorage?.maxBytesByMediaType?.[mediaType] || 0;
    if (!maxBytes) {
        throw new ProviderLayerError('asset_media_type_unsupported', `Asset media type ${mediaType} is not supported`, { mediaType });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
        throw new ProviderLayerError('asset_file_too_large', `Asset file exceeds ${mediaType} size limit`, { mediaType, sizeBytes, maxBytes });
    }
    const allowedTypes = config.assetStorage?.allowedMimeTypes?.[mediaType] || [];
    if (!allowedTypes.includes(contentType)) {
        throw new ProviderLayerError('asset_content_type_rejected', `Asset content type ${contentType} is not allowed for ${mediaType}`, { mediaType, contentType });
    }
    const extension = extensionFromName(fileName);
    if (!EXTENSIONS_BY_MEDIA_TYPE[mediaType]?.includes(extension)) {
        throw new ProviderLayerError('asset_extension_rejected', `Asset extension ${extension || '(missing)'} is not allowed for ${mediaType}`, { mediaType, fileName });
    }
}

function assetStorageMode(config) {
    return config.assetStorage?.mode || 'disabled';
}

function providerAssetStrategy(providerId, config) {
    return config.providerAssetStrategies?.[providerId] || {};
}

function localPublicUrl(config, storageKey) {
    const publicBaseUrl = (config.assetStorage?.publicBaseUrl || '').replace(/\/+$/, '');
    const localPublicPath = config.assetStorage?.localPublicPath || '/generated-assets';
    if (!publicBaseUrl) return '';
    return `${publicBaseUrl}${localPublicPath}/${encodeURIComponent(storageKey)}`;
}

export function createAssetUploadIntent(input, config = loadProviderConfig()) {
    const providerId = input.providerId || input.selectedProviderId || config.selectedProviderId;
    const strategy = providerAssetStrategy(providerId, config);
    const mode = assetStorageMode(config);
    assertUploadMetadataAllowed(input, config);

    if (strategy.inputUpload === 'provider_native_upload') {
        return {
            providerId,
            strategy: 'provider_native_upload',
            status: 'provider_native_required',
            message: 'Provider-native upload must be handled by the provider adapter.',
        };
    }

    if (strategy.inputUpload !== 'object_storage_url') {
        throw new ProviderLayerError('provider_upload_unsupported', `Provider ${providerId} does not support input upload through the asset layer`, { providerId });
    }

    if (mode === 'disabled') {
        throw new ProviderLayerError('asset_storage_unconfigured', `Asset storage is not configured for provider ${providerId}`, { providerId, mode });
    }

    if (mode !== 'local_public') {
        throw new ProviderLayerError('asset_storage_adapter_missing', `Asset storage mode ${mode} is not implemented`, { providerId, mode });
    }

    const assetId = createAssetId(providerId, input.mediaType);
    const storageKey = `${assetId}${extensionFromName(input.fileName)}`;
    const publicUrl = localPublicUrl(config, storageKey);
    if (!publicUrl) {
        throw new ProviderLayerError('asset_storage_unconfigured', 'Asset storage publicBaseUrl is required for provider input URLs', { providerId, mode });
    }

    const asset = upsertAsset({
        assetId,
        providerId,
        modelId: input.modelId || null,
        mediaType: input.mediaType,
        purpose: input.purpose || 'generation_input',
        source: 'user_upload',
        status: 'upload_intent_created',
        archiveStatus: 'not_required',
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        originalFileName: input.fileName,
        storageMode: mode,
        storageKey,
        url: assertSafeExternalAssetUrl(publicUrl, { providerId, mediaType: input.mediaType }),
        createdAt: new Date().toISOString(),
    });

    return {
        providerId,
        strategy: 'object_storage_url',
        asset,
        upload: {
            method: 'POST',
            url: `/api/assets/${assetId}/upload-binary`,
            headers: { 'content-type': input.contentType },
        },
    };
}

export function registerExternalAssetUrl(input, config = loadProviderConfig()) {
    const providerId = input.providerId || input.selectedProviderId || config.selectedProviderId;
    const safeUrl = assertSafeExternalAssetUrl(input.url, {
        providerId,
        mediaType: input.mediaType,
        modelId: input.modelId,
    });
    const assetId = createAssetId(providerId, input.mediaType);
    const asset = upsertAsset({
        assetId,
        providerId,
        modelId: input.modelId || null,
        mediaType: input.mediaType,
        purpose: input.purpose || 'generation_input',
        source: 'external_url',
        status: 'ready',
        archiveStatus: 'not_required',
        url: safeUrl,
        createdAt: new Date().toISOString(),
    });
    return { providerId, strategy: 'external_url', asset };
}
