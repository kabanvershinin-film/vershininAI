import { NextResponse } from 'next/server';
import { pollGenerationTask } from '../../../../../packages/studio/src/providers/orchestrator.js';
import { ProviderLayerError, normalizeProviderError } from '../../../../../packages/studio/src/providers/errors.js';
import { getTaskProviderId } from '../../../../../packages/studio/src/providers/task-store.js';
import { loadServerProviderConfig } from '../../../../../packages/studio/src/providers/server-control.js';

function credentialsFromRequest(request, providerId) {
    const envProviderId = providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const envKey = process.env[`GENAI_${envProviderId}_API_KEY`];
    const envKeys = process.env[`GENAI_${envProviderId}_API_KEYS`];
    const headerKey = request.headers.get(`x-${providerId}-api-key`) || request.headers.get('x-api-key');
    const cookieKey = providerId === 'muapi' ? request.cookies.get('muapi_key')?.value : undefined;
    const apiKey = envKey || headerKey || cookieKey || '';
    return {
        apiKey,
        apiKeys: (envKeys || apiKey).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean),
    };
}

export async function GET(request, { params }) {
    try {
        const resolvedParams = await params;
        const requestedProviderId = new URL(request.url).searchParams.get('providerId');
        const taskProviderId = getTaskProviderId(resolvedParams.taskId);
        if (!taskProviderId) {
            throw new ProviderLayerError('task_not_found', `Task ${resolvedParams.taskId} was not found`, { internalTaskId: resolvedParams.taskId });
        }
        if (requestedProviderId && requestedProviderId !== taskProviderId) {
            throw new ProviderLayerError('provider_mismatch', 'Polling provider must match the submitted task provider', {
                requestedProviderId,
                taskProviderId,
            });
        }
        const result = await pollGenerationTask(resolvedParams.taskId, {
            config: await loadServerProviderConfig(),
            credentials: credentialsFromRequest(request, taskProviderId),
            transport: {
                runtime: 'server',
                submitFetch: fetch,
                pollFetch: fetch,
                uploadFetch: fetch,
            },
        });
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        const normalized = normalizeProviderError(error);
        return NextResponse.json({ success: false, error: normalized }, { status: 400 });
    }
}
