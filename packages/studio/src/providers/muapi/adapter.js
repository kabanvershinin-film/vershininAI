import { ProviderLayerError } from '../errors.js';
import { normalizeProviderBaseUrl, readJsonResponse } from '../http.js';

function outputUrls(data) {
    const first = data?.outputs?.[0] || data?.url || data?.output?.url || data?.data?.url;
    return first ? [first] : [];
}

function statusFrom(data) {
    const raw = String(data?.status || '').toLowerCase();
    if (['completed', 'succeeded', 'success'].includes(raw)) return 'succeeded';
    if (['failed', 'error'].includes(raw)) return 'failed';
    if (['running', 'processing'].includes(raw)) return 'running';
    return outputUrls(data).length > 0 ? 'succeeded' : 'queued';
}

export const muapiAdapter = {
    id: 'muapi',
    displayName: 'MuAPI',
    capabilities: ['image', 'video', 'audio', 'workflow', 'agent', 'app'],

    buildRequestPlan(request) {
        const endpoint = request.endpoint || request.modelId;
        if (!endpoint) {
            throw new ProviderLayerError('muapi_endpoint_missing', 'MuAPI endpoint is missing', { providerId: 'muapi' });
        }
        return {
            family: 'muapi_legacy',
            mediaType: request.mediaType,
            operation: request.operation,
            modelId: request.modelId,
            endpointPath: `/api/v1/${endpoint}`,
            body: request.payload || request.inputs || {},
            polling: request.polling || 'muapi_prediction',
        };
    },

    async submit(plan, context) {
        const apiKey = context.apiKey || context.apiKeys?.[0] || '';
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'MuAPI API key is missing', { providerId: 'muapi' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, 'https://api.muapi.ai');
        const data = await readJsonResponse(await context.submitFetch(`${baseUrl}${plan.endpointPath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify(plan.body),
        }), 'MuAPI submit');
        const providerTaskId = data.request_id || data.id || null;
        return {
            providerId: 'muapi',
            providerTaskId,
            status: providerTaskId ? 'queued' : statusFrom(data),
            urls: outputUrls(data),
            raw: data,
        };
    },

    async poll(task, context) {
        const apiKey = context.apiKey || context.apiKeys?.[0] || '';
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'MuAPI API key is missing', { providerId: 'muapi' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, 'https://api.muapi.ai');
        const data = await readJsonResponse(await context.pollFetch(`${baseUrl}/api/v1/predictions/${task.providerTaskId}/result`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
        }), 'MuAPI poll');
        return {
            providerId: 'muapi',
            providerTaskId: task.providerTaskId,
            status: statusFrom(data),
            urls: outputUrls(data),
            raw: data,
        };
    },
};
