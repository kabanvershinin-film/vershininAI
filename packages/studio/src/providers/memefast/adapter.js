import { ProviderLayerError } from '../errors.js';
import { normalizeProviderBaseUrl, readJsonResponse } from '../http.js';
import { buildMemefastRequestPlan } from './request-plan.js';
import { prepareVideoPlanForSubmit } from './video-family.js';

function firstApiKey(context) {
    const keys = context.apiKeys?.filter(Boolean) || [];
    return keys[0] || context.apiKey || '';
}

function isHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function looksLikeBase64(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < 128 || text.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

function buildDataImageUrl(base64, outputFormat) {
    const normalizedFormat = String(outputFormat || '').trim().toLowerCase();
    const format = normalizedFormat === 'jpeg' || normalizedFormat === 'jpg'
        ? 'jpeg'
        : normalizedFormat === 'webp'
            ? 'webp'
            : 'png';
    const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    return `data:${mime};base64,${base64}`;
}

function isDataImageUrl(value) {
    return typeof value === 'string' && value.startsWith('data:image/');
}

function dataUrlToBlob(dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
    if (!match?.[2]) {
        throw new ProviderLayerError('image_reference_invalid', 'Unsupported data URL', {
            providerId: 'memefast',
        });
    }
    const mimeType = match[1] || 'image/png';
    const payload = match[2];
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
}

function inferImageFileExtension(mimeType, fallback = 'png') {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/png') return 'png';
    return fallback;
}

function outputUrls(data) {
    if (!data) return [];
    const urls = [];
    const seenUrls = new Set();

    const pushUrl = (value) => {
        if (typeof value !== 'string') return;
        if (!isHttpUrl(value) && !value.startsWith('data:image/')) return;
        if (seenUrls.has(value)) return;
        seenUrls.add(value);
        urls.push(value);
    };

    const pushUrlsFromText = (value) => {
        if (typeof value !== 'string') return;
        const text = value.trim();
        if (!text) return;
        pushUrl(text);

        const dataUrlMatches = text.match(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g) || [];
        for (const match of dataUrlMatches) pushUrl(match);

        const markdownImageMatches = text.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g);
        for (const match of markdownImageMatches) pushUrl(match[1]);

        const httpMatches = text.match(/https?:\/\/[^\s)"'<>]+/g) || [];
        for (const match of httpMatches) pushUrl(match.replace(/[.,;:!?]+$/, ''));
    };

    const pushBase64Image = (value, outputFormat) => {
        const base64 = typeof value === 'string' ? value.trim() : '';
        if (!looksLikeBase64(base64)) return;
        pushUrl(buildDataImageUrl(base64, outputFormat));
    };

    const walk = (value, hint = '', outputFormat) => {
        if (!value) return;
        if (typeof value === 'string') {
            if (hint === 'b64_json') {
                pushBase64Image(value, outputFormat);
                return;
            }
            if (hint === 'image_data') {
                pushBase64Image(value, outputFormat);
                pushUrlsFromText(value);
                return;
            }
            pushUrlsFromText(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) walk(item, hint, outputFormat);
            return;
        }
        if (typeof value === 'object') {
            const nestedOutputFormat = value.output_format || value.outputFormat || value.format || value.mime_type || value.mimeType || outputFormat;
            walk(value.url);
            walk(value.uri);
            walk(value.src);
            walk(value.href);
            walk(value.video_url);
            walk(value.audio_url);
            walk(value.image_url);
            walk(value.file_url);
            walk(value.output_url);
            walk(value.result_url);
            walk(value.text);
            walk(value.b64_json, 'b64_json', nestedOutputFormat);
            if (value.type === 'image') {
                walk(value.data, 'image_data', nestedOutputFormat);
                walk(value.image?.url);
            }
            if (value.inline_data?.data) {
                walk(value.inline_data.data, 'image_data', value.inline_data.mime_type || nestedOutputFormat);
            }
            if (value.inlineData?.data) {
                walk(value.inlineData.data, 'image_data', value.inlineData.mimeType || nestedOutputFormat);
            }
            walk(value.image_url?.url);
            walk(value.output, '', nestedOutputFormat);
            walk(value.outputs, '', nestedOutputFormat);
            walk(value.data, '', nestedOutputFormat);
            walk(value.result, '', nestedOutputFormat);
            walk(value.results, '', nestedOutputFormat);
            walk(value.video, '', nestedOutputFormat);
            walk(value.audio, '', nestedOutputFormat);
            walk(value.image, '', nestedOutputFormat);
            walk(value.choices, '', nestedOutputFormat);
            walk(value.message, '', nestedOutputFormat);
            walk(value.content, '', nestedOutputFormat);
        }
    };

    walk(data.urls);
    walk(data.output);
    walk(data.outputs);
    walk(data.url);
    walk(data.uri);
    walk(data.video_url);
    walk(data.audio_url);
    walk(data.image_url);
    walk(data.file_url);
    walk(data.result_url);
    walk(data.data);
    walk(data.result);
    walk(data.results);
    walk(data.choices);
    walk(data.message);
    walk(data.content);
    return urls;
}

function shouldRequireImmediateResult(plan) {
    return plan?.polling === 'none' && plan?.mediaType && plan.mediaType !== 'text';
}

function pollCandidates(baseUrl, task) {
    const id = encodeURIComponent(task.providerTaskId);
    const endpointPath = task.requestPlan?.endpointPath || '';
    const candidates = [
        `${baseUrl}/v1/tasks/${id}`,
        `${baseUrl}/v1/video/query/${id}`,
        `${baseUrl}/replicate/v1/predictions/${id}`,
        `${baseUrl}/suno/fetch/${id}`,
        `${baseUrl}/alibailian/api/v1/tasks/${id}`,
        `${baseUrl}/volc/v1/contents/generations/tasks/${id}`,
        `${baseUrl}/minimax/v1/query/video_generation?task_id=${id}`,
        `${baseUrl}/openapi/v2/video/result/${id}`,
    ];
    if (endpointPath.startsWith('/fal-ai/')) {
        candidates.unshift(`${baseUrl}${endpointPath}/requests/${id}`);
    }
    if (endpointPath.includes('/suno/')) {
        candidates.unshift(`${baseUrl}/suno/fetch/${id}`);
    }
    if (endpointPath.includes('/alibailian/')) {
        candidates.unshift(`${baseUrl}/alibailian/api/v1/tasks/${id}`);
    }
    if (endpointPath.includes('/volc/')) {
        candidates.unshift(`${baseUrl}/volc/v1/contents/generations/tasks/${id}`);
    }
    if (endpointPath.includes('/minimax/')) {
        candidates.unshift(`${baseUrl}/minimax/v1/query/video_generation?task_id=${id}`);
    }
    if (endpointPath.includes('/openapi/v2/video/')) {
        candidates.unshift(`${baseUrl}/openapi/v2/video/result/${id}`);
    }
    return Array.from(new Set(candidates));
}

function taskIdFrom(data) {
    return data?.id
        || data?.task_id
        || data?.request_id
        || data?.requestId
        || data?.prediction_id
        || data?.output?.task_id
        || data?.output?.request_id
        || data?.data?.id
        || data?.data?.task_id
        || data?.data?.request_id
        || data?.data?.requestId
        || null;
}

async function imageReferenceToUpload(reference, index) {
    if (isDataImageUrl(reference)) {
        const blob = dataUrlToBlob(reference);
        const extension = inferImageFileExtension(blob.type || 'image/png');
        return {
            blob,
            filename: `gpt-image-ref-${index + 1}.${extension}`,
        };
    }
    const response = await fetch(reference);
    if (!response.ok) {
        throw new ProviderLayerError('image_reference_fetch_failed', `Failed to fetch reference image: ${response.status}`, {
            providerId: 'memefast',
            status: response.status,
        });
    }
    const blob = await response.blob();
    const contentType = blob.type || 'image/png';
    const extension = inferImageFileExtension(contentType);
    return {
        blob,
        filename: `gpt-image-ref-${index + 1}.${extension}`,
    };
}

async function buildImageEditFormData(plan) {
    const images = Array.isArray(plan.body?.images)
        ? plan.body.images
        : Array.isArray(plan.body?.image_urls)
            ? plan.body.image_urls
            : plan.body?.image
                ? [plan.body.image]
                : [];
    if (images.length === 0) return null;
    const formData = new FormData();
    for (const [key, value] of Object.entries(plan.body || {})) {
        if (['images', 'image_urls', 'image'].includes(key) || value === undefined || value === null) continue;
        formData.append(key, String(value));
    }
    const uploadField = 'image';
    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const ref = typeof image === 'string'
            ? image.trim()
            : typeof image?.image_url === 'string'
                ? image.image_url.trim()
                : typeof image?.url === 'string'
                    ? image.url.trim()
                    : '';
        if (!ref) continue;
        const upload = await imageReferenceToUpload(ref, index);
        formData.append(uploadField, upload.blob, upload.filename);
    }
    return formData;
}

async function buildSubmitInit(plan, apiKey) {
    if (plan.endpointPath === '/v1/images/edits') {
        const formData = await buildImageEditFormData(plan);
        if (formData) {
            return {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                body: formData,
            };
        }
    }
    return {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(plan.body),
    };
}

function statusFrom(data) {
    const raw = String(data?.status || data?.output?.task_status || data?.data?.status || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done'].includes(raw)) return 'succeeded';
    if (['failed', 'error', 'cancelled'].includes(raw)) return 'failed';
    if (['running', 'processing', 'in_progress'].includes(raw)) return 'running';
    return outputUrls(data).length > 0 ? 'succeeded' : 'queued';
}

export const memefastAdapter = {
    id: 'memefast',
    displayName: 'MemeFast',
    capabilities: ['text', 'image', 'video', 'audio'],

    buildRequestPlan(request) {
        return buildMemefastRequestPlan(request);
    },

    async submit(plan, context) {
        const apiKey = firstApiKey(context);
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'MemeFast API key is missing', { providerId: 'memefast' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, 'https://memefast.top');
        const preparedPlan = await prepareVideoPlanForSubmit(plan, {
            ...context,
            baseUrl,
            apiKey,
        });
        const submitInit = await buildSubmitInit(preparedPlan, apiKey);
        const data = await readJsonResponse(await context.submitFetch(`${baseUrl}${preparedPlan.endpointPath}`, submitInit), 'MemeFast submit');
        const urls = outputUrls(data);
        if (shouldRequireImmediateResult(preparedPlan)) {
            if (urls.length === 0 && statusFrom(data) !== 'failed') {
                throw new ProviderLayerError(
                    'provider_result_parse_failed',
                    'MemeFast non-polling response did not contain a result URL',
                    {
                        providerId: 'memefast',
                        mediaType: preparedPlan.mediaType,
                        endpointPath: preparedPlan.endpointPath,
                        modelId: preparedPlan.modelId,
                    },
                );
            }
            return {
                providerId: 'memefast',
                providerTaskId: null,
                status: urls.length > 0 ? 'succeeded' : statusFrom(data),
                urls,
                raw: data,
            };
        }
        const taskId = taskIdFrom(data);
        return {
            providerId: 'memefast',
            providerTaskId: taskId,
            status: urls.length > 0 ? 'succeeded' : statusFrom(data),
            urls,
            raw: data,
        };
    },

    async poll(task, context) {
        const apiKey = firstApiKey(context);
        if (!apiKey) {
            throw new ProviderLayerError('provider_auth_missing', 'MemeFast API key is missing', { providerId: 'memefast' });
        }
        if (!task.providerTaskId) {
            throw new ProviderLayerError('provider_task_missing', 'MemeFast task id is missing', { providerId: 'memefast' });
        }
        const baseUrl = normalizeProviderBaseUrl(context.baseUrl, 'https://memefast.top');
        const candidates = pollCandidates(baseUrl, task);
        let lastError = null;
        for (const url of candidates) {
            try {
                const data = await readJsonResponse(await context.pollFetch(url, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                }), 'MemeFast poll');
                return {
                    providerId: 'memefast',
                    providerTaskId: task.providerTaskId,
                    status: statusFrom(data),
                    urls: outputUrls(data),
                    raw: data,
                };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new ProviderLayerError('provider_poll_failed', 'MemeFast poll failed', { providerId: 'memefast' });
    },
};
