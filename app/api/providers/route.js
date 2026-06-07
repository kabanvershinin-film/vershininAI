import { NextResponse } from 'next/server';
import { getProviderConfigSnapshot } from '../../../packages/studio/src/providers/config.js';
import { normalizeProviderError } from '../../../packages/studio/src/providers/errors.js';
import { listProviderAdapters } from '../../../packages/studio/src/providers/registry.js';
import { applyProviderPatch, loadServerProviderConfig, saveServerProviderConfig } from '../../../packages/studio/src/providers/server-control.js';

export async function GET() {
    const serverConfig = await loadServerProviderConfig();
    const config = getProviderConfigSnapshot(serverConfig);
    return NextResponse.json({
        success: true,
        data: {
            adapters: listProviderAdapters(),
            config,
            defaultProvider: process.env.GENAI_DEFAULT_PROVIDER || config.selectedProviderId || 'memefast',
            providerMode: process.env.GENAI_PROVIDER_MODE || 'server',
        },
    });
}

export async function PATCH(request) {
    try {
        const body = await request.json();
        const currentConfig = await loadServerProviderConfig();
        const nextConfig = await saveServerProviderConfig(applyProviderPatch(currentConfig, body));
        return NextResponse.json({
            success: true,
            data: {
                config: getProviderConfigSnapshot(nextConfig),
            },
        });
    } catch (error) {
        const normalized = normalizeProviderError(error, 'provider_control_failed');
        return NextResponse.json({ success: false, error: normalized }, { status: 400 });
    }
}
