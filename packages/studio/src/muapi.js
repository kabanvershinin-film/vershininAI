import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getLipSyncModelById, getAudioModelById } from './models.js';
import { getBrowserProviderCredentials, loadProviderConfig } from './providers/config.js';
import { pollGenerationTask, submitGenerationRequest } from './providers/orchestrator.js';
import { getMemefastFamilyManifest, inferMemefastFamily } from './providers/memefast/capabilities.js';

// In an http(s) browser we route through the host app's proxy (Next.js routes
// under /api/* re-issue the call server-side) so api.muapi.ai CORS is bypassed.
// SSR (no window) and Electron's file:// renderer call the upstream directly.
const BASE_URL = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
    ? '/api'
    : 'https://api.muapi.ai';
const PROXY_WF_BASE = '/api/workflow';

function getSelectedProviderId() {
    return loadProviderConfig().selectedProviderId || 'memefast';
}

function shouldUseProviderLayer() {
    return getSelectedProviderId() !== 'muapi';
}

function shouldUseServerProviderRoute() {
    return typeof window !== 'undefined' && window.location?.protocol?.startsWith('http');
}

export function resolveProviderPollPolicy({ mediaType, modelId } = {}) {
    const normalizedModelId = String(modelId || '').toLowerCase();
    if (mediaType === 'video') {
        return { maxAttempts: 180, interval: 5000 };
    }
    if (mediaType === 'audio') {
        return { maxAttempts: 120, interval: 3000 };
    }
    if (mediaType === 'text' || mediaType === 'chat') {
        return { maxAttempts: 60, interval: 2000 };
    }
    if (mediaType === 'image' && normalizedModelId.startsWith('gpt-image-2')) {
        return { maxAttempts: 250, interval: 2000 };
    }
    if (mediaType === 'image') {
        return { maxAttempts: 120, interval: 2000 };
    }
    return { maxAttempts: 60, interval: 2000 };
}

function buildIdempotencyKey(operation, params) {
    return `${operation}:${params?.model || params?._modelId || 'unknown'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function shouldUseInlineProviderUpload(providerId, mediaType, modelId) {
    if (providerId !== 'memefast' || mediaType !== 'image' || !modelId) return false;
    const family = inferMemefastFamily({ mediaType: 'image', operation: 'i2i', modelId });
    const manifest = getMemefastFamilyManifest('image', family);
    return Boolean(manifest?.supportsBase64 && !manifest.requiresHostedUrl);
}

function readFileAsDataUrl(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        };
        reader.onload = () => {
            onProgress?.(100);
            resolve(reader.result);
        };
        reader.onerror = () => reject(new Error('asset_upload_failed: Failed to read local image'));
        reader.readAsDataURL(file);
    });
}

function normalizeProviderLayerResult(result) {
    const displayUrls = result.stableUrls?.length > 0 ? result.stableUrls : (result.urls || []);
    return {
        ...result.raw,
        request_id: result.taskId,
        taskId: result.taskId,
        status: result.status,
        url: displayUrls[0],
        urls: displayUrls,
        providerUrls: result.urls || [],
        stableUrls: result.stableUrls || [],
        resultAssetIds: result.resultAssetIds || [],
        resultArchiveStatus: result.resultArchiveStatus || 'not_started',
    };
}

async function pollProviderTaskUntilDone(taskId, credentials, maxAttempts = 900, interval = 2000, providerId = getSelectedProviderId()) {
    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        let result;
        if (shouldUseServerProviderRoute()) {
            const response = await fetch(`/api/generation/tasks/${taskId}?providerId=${encodeURIComponent(providerId)}`, {
                headers: {
                    ...providerKeyHeaders(providerId, credentials.apiKey || ''),
                },
            });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                const message = payload.error?.message || `Provider poll failed: ${response.status}`;
                throw new Error(message);
            }
            result = payload.data;
        } else {
            result = await pollGenerationTask(taskId, {
                credentials,
                transport: {
                    runtime: 'browser-byok',
                    submitFetch: fetch,
                    pollFetch: fetch,
                    uploadFetch: fetch,
                },
            });
        }
        lastResult = result;
        if (result.status === 'succeeded' || result.urls?.length > 0) {
            return result;
        }
        if (result.status === 'failed') {
            throw new Error(result.errorMessage || 'Generation failed');
        }
    }
    throw new Error(lastResult?.status ? `Generation timed out with status ${lastResult.status}` : 'Generation timed out after polling.');
}

export async function resumeProviderTask(apiKey, params = {}) {
    const taskId = params.taskId || params.requestId;
    if (!taskId) throw new Error('Missing task id for provider task resume.');
    const providerId = params.providerId || getSelectedProviderId();
    const policy = resolveProviderPollPolicy({
        mediaType: params.mediaType || 'image',
        modelId: params.modelId,
    });
    if (providerId === 'muapi') {
        const result = await pollForResult(taskId, apiKey, policy.maxAttempts, policy.interval);
        const outputUrl = result.outputs?.[0] || result.url || result.output?.url;
        return { ...result, request_id: taskId, taskId, url: outputUrl };
    }
    const credentials = getBrowserProviderCredentials(providerId);
    if (!credentials.apiKey && apiKey) {
        credentials.apiKey = apiKey;
        credentials.apiKeys = [apiKey];
    }
    const result = await pollProviderTaskUntilDone(
        taskId,
        credentials,
        policy.maxAttempts,
        policy.interval,
        providerId,
    );
    return normalizeProviderLayerResult(result);
}

function providerKeyHeaders(providerId, apiKey) {
    if (!apiKey) return {};
    return {
        'x-provider-byok': '1',
        'x-api-key': apiKey,
        [`x-${providerId}-api-key`]: apiKey,
    };
}

async function submitViaProviderLayer(operation, mediaType, apiKey, params, extraInputs = {}) {
    const selectedProviderId = getSelectedProviderId();
    const modelId = params._modelId || params.model;
    const pollPolicy = resolveProviderPollPolicy({ mediaType, modelId });
    const request = {
        selectedProviderId,
        mediaType,
        operation,
        modelId,
        prompt: params.prompt || params.text || '',
        negativePrompt: params.negative_prompt || params.negativePrompt || '',
        audio: params.audio ?? params.generate_audio,
        idempotencyKey: params.idempotencyKey || buildIdempotencyKey(operation, params),
        inputs: {
            ...params,
            ...extraInputs,
            aspectRatio: params.aspect_ratio || params.aspectRatio,
            imageUrl: params.image_url || params.imageUrl,
            imageUrls: params.images_list || params.imageUrls,
            firstFrame: params.first_frame || params.firstFrame || params.image_url || params.imageUrl,
            lastFrame: params.last_image || params.lastFrame || params.last_image_url || params.end_image_url,
            videoUrl: params.video_url || params.videoUrl,
            videoUrls: params.video_files || params.videoUrls,
            audioUrl: params.audio_url || params.audioUrl,
            audioUrls: params.audios_list || params.audioUrls,
            requestId: params.request_id || params.requestId,
        },
    };
    if (shouldUseServerProviderRoute()) {
        const credentials = getBrowserProviderCredentials(selectedProviderId);
        const response = await fetch('/api/generation/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'idempotency-key': request.idempotencyKey,
                ...providerKeyHeaders(selectedProviderId, credentials.apiKey || apiKey || ''),
            },
            body: JSON.stringify(request),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
            const message = payload.error?.message || `Provider request failed: ${response.status}`;
            throw new Error(message);
        }
        const result = payload.data;
        if (params.onRequestId && result.taskId) params.onRequestId(result.taskId);
        const finalResult = result.urls?.length > 0 || result.status === 'succeeded' || result.status === 'failed'
            ? result
            : await pollProviderTaskUntilDone(result.taskId, credentials, pollPolicy.maxAttempts, pollPolicy.interval, selectedProviderId);
        return normalizeProviderLayerResult(finalResult);
    }

    const credentials = getBrowserProviderCredentials(selectedProviderId);
    if (!credentials.apiKey && apiKey && selectedProviderId === 'muapi') {
        credentials.apiKey = apiKey;
        credentials.apiKeys = [apiKey];
    }
    const result = await submitGenerationRequest(request, {
        idempotencyKey: request.idempotencyKey,
        credentials,
        transport: {
            runtime: 'browser-byok',
            submitFetch: fetch,
            pollFetch: fetch,
            uploadFetch: fetch,
        },
    });
    if (params.onRequestId && result.taskId) params.onRequestId(result.taskId);
    const finalResult = result.urls?.length > 0 || result.status === 'succeeded' || result.status === 'failed'
        ? result
        : await pollProviderTaskUntilDone(result.taskId, credentials, pollPolicy.maxAttempts, pollPolicy.interval, selectedProviderId);
    return normalizeProviderLayerResult(finalResult);
}

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('muapi:auth-required', { detail: { status, message: detail } }));
}

async function pollForResult(requestId, key, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${BASE_URL}/api/v1/predictions/${requestId}/result`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': key }
            });
            if (!response.ok) {
                const errText = await response.text();
                if (response.status >= 500) continue;
                notifyAuthRequired(response.status, errText);
                throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 100)}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Generation failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Generation timed out after polling.');
}

async function submitAndPoll(endpoint, payload, key, onRequestId, maxAttempts = 60) {
    const url = `${BASE_URL}/api/v1/${endpoint}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const requestId = submitData.request_id || submitData.id;
    if (!requestId) return submitData;
    if (onRequestId) onRequestId(requestId);
    const result = await pollForResult(requestId, key, maxAttempts);
    const outputUrl = result.outputs?.[0] || result.url || result.output?.url;
    return { ...result, url: outputUrl };
}

export async function generateImage(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('t2i', 'image', apiKey, params);
    }
    const modelInfo = getModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = { prompt: params.prompt };
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.image_url) { 
        payload.image_url = params.image_url; 
        payload.strength = params.strength || 0.6; 
    } else if (params.images_list) {
        payload.images_list = params.images_list;
    } else {
        payload.image_url = null;
    }
    if (params.seed && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 60);
}

export async function generateI2I(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('i2i', 'image', apiKey, params);
    }
    const modelInfo = getI2IModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    const imagesList = params.images_list?.length > 0 ? params.images_list : (params.image_url ? [params.image_url] : null);
    if (imagesList) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        else payload[imageField] = imagesList[0];
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 60);
}

export async function generateVideo(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('t2v', 'video', apiKey, params);
    }
    const modelInfo = getVideoModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (params.image_url) payload.image_url = params.image_url;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateI2V(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('i2v', 'video', apiKey, params);
    }
    const modelInfo = getI2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    if (params.image_url) {
        if (imageField === 'images_list') payload.images_list = [params.image_url];
        else payload[imageField] = params.image_url;
    }
    const lastImageField = modelInfo?.lastImageField;
    if (lastImageField && params.last_image) {
        payload[lastImageField] = params.last_image;
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateMarketingStudioAd(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('i2v', 'video', apiKey, {
            ...params,
            model: params.model || 'seedance-2-vip-omni-reference',
        });
    }
    const endpoint = params.resolution === '1080p' ? 'sd-2-vip-omni-reference-1080p' : 'seedance-2-vip-omni-reference';
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: params.duration || 5,
        images_list: params.images_list || [],
        video_files: params.video_files || []
    };
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function processV2V(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('v2v', 'video', apiKey, params);
    }
    const modelInfo = getV2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const videoField = modelInfo?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (modelInfo?.imageField && params.image_url) {
        payload[modelInfo.imageField] = params.image_url;
    }
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function processLipSync(apiKey, params) {
    if (shouldUseProviderLayer()) {
        return submitViaProviderLayer('lipsync', 'video', apiKey, params);
    }
    const modelInfo = getLipSyncModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (modelInfo?.hasPrompt) payload.prompt = params.prompt || '';
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateAudio(apiKey, params) {
    if (shouldUseProviderLayer()) {
        const modelId = params._modelId || params.model || '';
        const modelInfo = getAudioModelById(modelId);
        const operation = modelInfo?.family === 'suno' || /^suno[-_]/i.test(modelId) ? 'music' : 'tts';
        return submitViaProviderLayer(operation, 'audio', apiKey, params);
    }
    const modelId = params._modelId || params.model;
    const modelInfo = getAudioModelById(modelId);
    const endpoint = modelInfo?.endpoint || modelId;
    const payload = {};
    const skipKeys = ['_modelId', 'onRequestId'];
    for (const key in params) {
        if (!skipKeys.includes(key) && params[key] !== undefined && params[key] !== null) {
            payload[key] = params[key];
        }
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export function uploadFile(apiKey, file, onProgress, options = {}) {
    if (shouldUseProviderLayer()) {
        const selectedProviderId = getSelectedProviderId();
        if (!shouldUseServerProviderRoute()) {
            return Promise.reject(new Error(`File upload for provider ${selectedProviderId} requires the server asset upload endpoint.`));
        }
        return new Promise(async (resolve, reject) => {
            try {
                const mediaType = file.type?.startsWith('video/')
                    ? 'video'
                    : file.type?.startsWith('audio/')
                        ? 'audio'
                        : 'image';
                if (shouldUseInlineProviderUpload(selectedProviderId, mediaType, options.modelId)) {
                    resolve(await readFileAsDataUrl(file, onProgress));
                    return;
                }
                const intentResponse = await fetch('/api/assets/upload-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selectedProviderId,
                        providerId: selectedProviderId,
                        mediaType,
                        modelId: options.modelId || null,
                        fileName: file.name,
                        contentType: file.type,
                        sizeBytes: file.size,
                        purpose: 'generation_input',
                    }),
                });
                const intentPayload = await intentResponse.json();
                if (!intentResponse.ok || !intentPayload.success) {
                    const code = intentPayload.error?.code || 'asset_upload_intent_failed';
                    const message = intentPayload.error?.message || `Asset upload intent failed: ${intentResponse.status}`;
                    reject(new Error(`${code}: ${message}`));
                    return;
                }
                const upload = intentPayload.data.upload;
                const asset = intentPayload.data.asset;
                if (!upload?.url || !asset?.url) {
                    reject(new Error(`provider_upload_unsupported: Provider ${selectedProviderId} did not return an upload URL`));
                    return;
                }

                const xhr = new XMLHttpRequest();
                xhr.open(upload.method || 'POST', upload.url);
                for (const [header, value] of Object.entries(upload.headers || {})) {
                    xhr.setRequestHeader(header, value);
                }
                if (onProgress) {
                    xhr.upload.onprogress = (event) => {
                        if (event.lengthComputable) {
                            onProgress(Math.round((event.loaded / event.total) * 100));
                        }
                    };
                }
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(asset.url);
                    } else {
                        reject(new Error(`asset_upload_failed: ${xhr.status} ${xhr.statusText}`));
                    }
                };
                xhr.onerror = () => reject(new Error('asset_upload_failed: Network error during asset upload'));
                xhr.send(file);
            } catch (error) {
                reject(error);
            }
        });
    }
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}/api/v1/upload_file`;
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('x-api-key', apiKey);

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const fileUrl = data.url || data.file_url || data.data?.url;
                    if (!fileUrl) {
                        reject(new Error('No URL returned from file upload'));
                    } else {
                        resolve(fileUrl);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse upload response'));
                }
            } else {
                let detail = xhr.statusText;
                try {
                    const errObj = JSON.parse(xhr.responseText);
                    detail = errObj.detail || detail;
                } catch (e) {
                    // Use statusText when the response body has no structured detail.
                }
                notifyAuthRequired(xhr.status, detail);
                reject(new Error(`File upload failed: ${xhr.status} - ${detail}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.send(formData);
    });
}

export async function getUserBalance(apiKey) {
    const response = await fetch(`${BASE_URL}/api/v1/account/balance`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        throw new Error(`Failed to fetch balance: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getTemplateWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-template-workflows`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch template workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getUserWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-workflow-defs`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch user workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getPublishedWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-published-workflows`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch published workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

// Agents — uses direct URL → https://api.muapi.ai/agents/...
export async function getTemplateAgents(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/templates/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch template agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

export async function getUserAgents(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/user/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch user agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

export async function getPublishedAgents(apiKey) {
    // MuAPI: GET /agents/featured/agents
    const response = await fetch(`${BASE_URL}/agents/featured/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch featured agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

// GET /agents/user/conversations — returns the user's chat history across all agents
export async function getUserConversations(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/user/conversations`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch conversations: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
};

export async function createWorkflow(apiKey, payload) {
    const response = await fetch(`${BASE_URL}/workflow/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to create workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function updateWorkflowName(apiKey, workflowId, name) {
    const response = await fetch(`${BASE_URL}/workflow/update-name/${workflowId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ name })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to rename workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function deleteWorkflow(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/delete-workflow-def/${workflowId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to delete workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getWorkflowInputs(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-inputs`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch workflow inputs: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function executeWorkflow(apiKey, workflowId, inputs) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ inputs })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to execute workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const runId = submitData.run_id || submitData.id;
    if (!runId) return submitData;
    
    // Poll for results
    return await pollWorkflowResult(runId, apiKey);
};

async function pollWorkflowResult(runId, apiKey, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${BASE_URL}/workflow/run/${runId}/api-outputs`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }
            });
            if (!response.ok) {
                if (response.status >= 500) continue;
                throw new Error(`Poll Failed: ${response.status}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Workflow failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Workflow timed out after polling.');
};

export async function getAllNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/node-schemas`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch node schemas: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getWorkflowData(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/get-workflow-def/${workflowId}`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch workflow data: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-node-schemas`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch node schemas: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function runSingleNode(apiKey, workflowId, nodeId, payload) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/node/${nodeId}/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to run single node: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function deleteNodeRun(apiKey, nodeRunId) {
    const response = await fetch(`${BASE_URL}/workflow/node-run/${nodeRunId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to delete node run: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getNodeStatus(apiKey, runId) {
    const response = await fetch(`${BASE_URL}/workflow/run/${runId}/status`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to get node status: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

/**
 * Handle proxy requests centralizing communication logic with MuAPI.
 * This is used by the server-side entry points.
 */
export async function handleProxyRequest(prefix, path, method, headers, body, apiKey) {
    const url = `${BASE_URL}/${prefix}/${path}`;
    
    const finalHeaders = new Headers(headers);
    finalHeaders.delete('host');
    finalHeaders.delete('connection');
    finalHeaders.delete('content-length'); // Let fetch recalculate this for safety

    if (apiKey) {
        finalHeaders.set('x-api-key', apiKey);
    }

    try {
        const response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
            redirect: 'follow',
        });

        const contentType = response.headers.get('Content-Type') || 'application/json';
        const buffer = await response.arrayBuffer();
        
        return {
            status: response.status,
            contentType,
            data: buffer
        };
    } catch (error) {
        console.error(`MuAPI Proxy error for ${url}:`, error);
        throw error;
    }
}

/**
 * A centralized handler for Next.js API routes or middleware.
 */
export async function handleServerSideProxy(prefix, request, params, apiKey) {
    try {
        const slug = await params;
        const pathSegments = slug.path || [];
        const path = pathSegments.join('/');
        
        const method = request.method;
        let body = null;
        if (method !== 'GET' && method !== 'HEAD') {
            body = await request.arrayBuffer();
        }

        const { search } = new URL(request.url);
        const pathWithSearch = search ? `${path}${search}` : path;

        return await handleProxyRequest(
            prefix, 
            pathWithSearch, 
            method, 
            request.headers, 
            body, 
            apiKey
        );
    } catch (error) {
        console.error(`Server proxy failed:`, error);
        throw error;
    }
}

export async function calculateDynamicCost(apiKey, taskName, payload) {
    const response = await fetch(`${BASE_URL}/api/v1/app/calculate_dynamic_cost`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ task_name: taskName, payload })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to calculate dynamic cost: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function registerAppInterest(apiKey, appName) {
    const response = await fetch(`${BASE_URL}/app/interest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ app_name: appName })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to register interest: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getAppInterests(apiKey) {
    const response = await fetch(`${BASE_URL}/app/interests`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch interests: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function runClipping(apiKey, params) {
    const payload = {
        video_url: params.video_url,
        num_highlights: params.num_highlights || 3,
        aspect_ratio: params.aspect_ratio || "9:16",
        return_coordinates_only: !!params.return_coordinates_only
    };
    return submitAndPoll("ai-clipping", payload, apiKey, params.onRequestId, 900);
}

export async function runMotionGraphics(apiKey, params) {
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics", payload, apiKey, params.onRequestId, 900);
}

export async function runMotionGraphicsEdit(apiKey, params) {
    const payload = {
        request_id: params.request_id,
        edit_prompt: params.edit_prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics-edit", payload, apiKey, params.onRequestId, 900);
}
