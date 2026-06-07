import { NextResponse } from 'next/server';
import { submitGenerationRequest } from '../../../../packages/studio/src/providers/orchestrator.js';
import { normalizeProviderError } from '../../../../packages/studio/src/providers/errors.js';
import { enforceServerProviderSelection, loadServerProviderConfig } from '../../../../packages/studio/src/providers/server-control.js';

const DEFAULT_TEXT_SUBMIT_TIMEOUT_MS = 60_000;
const DEFAULT_NON_TEXT_SUBMIT_TIMEOUT_MS = 500_000;

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

function resolveSubmitTimeoutMs(body = {}) {
    const explicit = Number(body.submitTimeoutMs || body.timeoutMs);
    if (Number.isFinite(explicit) && explicit > 0) {
        return Math.max(1_000, Math.min(900_000, Math.trunc(explicit)));
    }
    const mediaType = String(body.mediaType || '').toLowerCase();
    return mediaType === 'text' || mediaType === 'chat'
        ? DEFAULT_TEXT_SUBMIT_TIMEOUT_MS
        : DEFAULT_NON_TEXT_SUBMIT_TIMEOUT_MS;
}

function createTimeoutError(timeoutMs) {
    const error = new Error(`Provider submit timed out after ${Math.round(timeoutMs / 1000)}s`);
    error.name = 'TimeoutError';
    error.status = 504;
    error.transient = true;
    error.phase = 'submit';
    error.timeoutMs = timeoutMs;
    return error;
}

function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(createTimeoutError(ms)), ms);
    return controller.signal;
}

function withSubmitTimeout(fetchImpl, timeoutMs) {
    return async (input, init = {}) => {
        try {
            return await fetchImpl(input, {
                ...init,
                signal: init.signal || timeoutSignal(timeoutMs),
            });
        } catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                throw createTimeoutError(timeoutMs);
            }
            throw error;
        }
    };
}

function serverTransport(timeoutMs) {
    return {
        runtime: 'server',
        submitFetch: withSubmitTimeout(fetch, timeoutMs),
        pollFetch: fetch,
        uploadFetch: fetch,
    };
}

export async function POST(request) {
    try {
        const body = await request.json();
        const providerMode = process.env.GENAI_PROVIDER_MODE || (request.headers.get('x-provider-byok') === '1' ? 'client' : 'server');
        const serverConfig = await loadServerProviderConfig();
        const controlledBody = enforceServerProviderSelection(body, serverConfig, providerMode);
        const providerIdForCredentials = controlledBody.selectedProviderId || controlledBody.providerId || serverConfig.selectedProviderId || process.env.GENAI_DEFAULT_PROVIDER || 'memefast';
        const submitTimeoutMs = resolveSubmitTimeoutMs(controlledBody);
        const result = await submitGenerationRequest(controlledBody, {
            idempotencyKey: request.headers.get('idempotency-key') || body.idempotencyKey,
            allowProviderOverride: providerMode === 'client' && Boolean(body.providerOverrideReason),
            config: serverConfig,
            credentials: credentialsFromRequest(request, providerIdForCredentials),
            transport: serverTransport(submitTimeoutMs),
        });
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        const normalized = normalizeProviderError(error);
        return NextResponse.json({ success: false, error: normalized }, { status: normalized.code === 'provider_auth_missing' ? 401 : 400 });
    }
}
