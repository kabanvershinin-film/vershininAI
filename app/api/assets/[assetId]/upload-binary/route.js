import { NextResponse } from 'next/server';
import { getAsset, upsertAsset } from '../../../../../packages/studio/src/providers/assets/asset-store.js';
import { normalizeProviderError, ProviderLayerError } from '../../../../../packages/studio/src/providers/errors.js';
import { loadServerProviderConfig } from '../../../../../packages/studio/src/providers/server-control.js';

async function writeLocalPublicAsset(asset, request, config) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length !== asset.sizeBytes) {
        throw new ProviderLayerError('asset_size_mismatch', 'Uploaded asset size does not match the upload intent', {
            assetId: asset.assetId,
            expected: asset.sizeBytes,
            actual: body.length,
        });
    }
    const root = process.cwd();
    const localPublicDir = config.assetStorage?.localPublicDir || 'public/generated-assets';
    const targetDir = path.resolve(root, localPublicDir);
    const publicRoot = path.resolve(root, 'public');
    if (!targetDir.startsWith(publicRoot)) {
        throw new ProviderLayerError('asset_storage_path_rejected', 'Local asset storage must stay inside public/', { targetDir });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.resolve(targetDir, asset.storageKey);
    if (!targetPath.startsWith(targetDir)) {
        throw new ProviderLayerError('asset_storage_path_rejected', 'Asset storage key escapes the target directory', { targetPath });
    }
    fs.writeFileSync(targetPath, body);
    return upsertAsset({
        ...asset,
        status: 'ready',
        uploadedAt: new Date().toISOString(),
    });
}

export async function POST(request, { params }) {
    try {
        const resolvedParams = await params;
        const asset = getAsset(resolvedParams.assetId);
        if (!asset) {
            throw new ProviderLayerError('asset_not_found', `Asset ${resolvedParams.assetId} was not found`, { assetId: resolvedParams.assetId });
        }
        const config = await loadServerProviderConfig();
        const mode = config.assetStorage?.mode || 'disabled';
        if (mode !== 'local_public') {
            throw new ProviderLayerError('asset_storage_adapter_missing', `Binary upload adapter for storage mode ${mode} is not implemented`, { mode });
        }
        const updated = await writeLocalPublicAsset(asset, request, config);
        return NextResponse.json({ success: true, data: { asset: updated } });
    } catch (error) {
        const normalized = normalizeProviderError(error, 'asset_upload_failed');
        return NextResponse.json({ success: false, error: normalized }, { status: 400 });
    }
}
