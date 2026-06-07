import { NextResponse } from 'next/server';
import { registerExternalAssetUrl } from '../../../../packages/studio/src/providers/assets/upload-policy.js';
import { normalizeProviderError } from '../../../../packages/studio/src/providers/errors.js';
import { loadServerProviderConfig } from '../../../../packages/studio/src/providers/server-control.js';

export async function POST(request) {
    try {
        const body = await request.json();
        const result = registerExternalAssetUrl(body, await loadServerProviderConfig());
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        const normalized = normalizeProviderError(error, 'asset_external_url_failed');
        return NextResponse.json({ success: false, error: normalized }, { status: 400 });
    }
}
