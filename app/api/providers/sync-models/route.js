import { NextResponse } from 'next/server';
import {
    assertNoModelRetentionLoss,
    buildProviderInventoryFromModels,
    buildStaticMemefastInventory,
    loadModelSnapshot,
    mergeModelInventory,
    saveModelSnapshot,
    summarizeInventory,
} from '../../../../packages/studio/src/providers/model-inventory.js';

function normalizeBaseUrl(baseUrl, defaultBaseUrl) {
    return (baseUrl || defaultBaseUrl).replace(/\/+$/, '');
}

async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

export async function POST(request) {
    try {
        const body = await request.json();
        const providerId = body.providerId || 'memefast';
        const baseUrl = normalizeBaseUrl(body.baseUrl, providerId === 'memefast' ? 'https://memefast.top' : 'https://api.muapi.ai');
        const apiKeys = (body.apiKeys || body.apiKey || '').split?.(/[\n,]+/)?.map((item) => item.trim()).filter(Boolean) || [];
        const before = loadModelSnapshot();
        const incoming = [];

        if (providerId === 'memefast') {
            incoming.push(...buildStaticMemefastInventory());
            incoming.push(...buildProviderInventoryFromModels(providerId, await fetchJson(`${baseUrl}/api/pricing_new`), ['pricing_new']));
            for (const apiKey of apiKeys) {
                incoming.push(...buildProviderInventoryFromModels(providerId, await fetchJson(`${baseUrl}/v1/models`, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                }), ['v1_models']));
            }
        }

        const merged = mergeModelInventory(providerId, incoming, before);
        const beforeSummary = summarizeInventory(before);
        const afterSummary = summarizeInventory(merged);
        assertNoModelRetentionLoss(beforeSummary, afterSummary);
        saveModelSnapshot(merged);

        return NextResponse.json({
            success: true,
            data: {
                providerId,
                count: Object.keys(merged[providerId] || {}).length,
                summary: afterSummary[providerId] || { total: 0, byMediaType: {} },
            },
        });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: {
                code: 'model_sync_failed',
                message: error instanceof Error ? error.message : String(error),
            },
        }, { status: 400 });
    }
}
