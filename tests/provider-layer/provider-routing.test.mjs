import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getProviderApiKey, loadProviderConfig } from '../../packages/studio/src/providers/config.js';
import { resolveGenerationTarget } from '../../packages/studio/src/providers/feature-router.js';
import {
    buildStaticMemefastInventory,
    mergeModelInventory,
    summarizeInventory,
    assertNoModelRetentionLoss,
} from '../../packages/studio/src/providers/model-inventory.js';
import { pollGenerationTask, submitGenerationRequest } from '../../packages/studio/src/providers/orchestrator.js';
import { createAssetUploadIntent, registerExternalAssetUrl } from '../../packages/studio/src/providers/assets/upload-policy.js';
import { archiveProviderResultUrls } from '../../packages/studio/src/providers/assets/result-archive.js';
import { applyProviderPatch, enforceServerProviderSelection, loadServerProviderConfig } from '../../packages/studio/src/providers/server-control.js';
import {
    buildMemefastRequestPlan,
} from '../../packages/studio/src/providers/memefast/request-plan.js';
import { normalizeProviderError } from '../../packages/studio/src/providers/errors.js';
import {
    prepareVideoPlanForSubmit,
} from '../../packages/studio/src/providers/memefast/video-family.js';
import {
    inferMemefastFamily,
    listMemefastRequestPlanEvidence,
    normalizeMemefastModelId,
} from '../../packages/studio/src/providers/memefast/capabilities.js';
import { volcengineAdapter } from '../../packages/studio/src/providers/volcengine/adapter.js';

function installLocalStorage() {
    const store = new Map();
    global.window = { localStorage: null };
    global.localStorage = {
        getItem: (key) => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
    };
    global.window.localStorage = global.localStorage;
    return store;
}

function writeConfig(config) {
    localStorage.setItem('genai_provider_config', JSON.stringify({
        schemaVersion: 1,
        selectedProviderId: 'memefast',
        providerSwitchMode: 'global',
        allowSilentProviderFallback: false,
        providers: [
            { id: 'muapi', platform: 'muapi', name: 'MuAPI', baseUrl: 'https://api.muapi.ai', enabled: true },
            { id: 'memefast', platform: 'memefast', name: 'MemeFast', baseUrl: 'https://memefast.top', enabled: true },
        ],
        providerDefaults: {
            memefast: {
                'text:chat': ['memefast:gemini-3.1-pro-preview'],
                'image:t2i': ['memefast:doubao-seedream-5-0-260128'],
                'video:i2v': ['memefast:sora-2'],
            },
        },
        explicitFeatureOverrides: {
            'workflow:workflow_run': {
                bindings: ['muapi:workflow'],
                reason: 'muapi-only capability',
            },
        },
        disabledProviders: [],
        disabledModels: [],
        disabledRouteFamilies: [],
        ...config,
    }));
}

test('selectedProviderId=memefast resolves text/image/video to MemeFast', () => {
    installLocalStorage();
    writeConfig();

    assert.equal(resolveGenerationTarget({ mediaType: 'text', operation: 'chat' }).providerId, 'memefast');
    assert.equal(resolveGenerationTarget({ mediaType: 'image', operation: 't2i' }).providerId, 'memefast');
    assert.equal(resolveGenerationTarget({ mediaType: 'video', operation: 'i2v' }).providerId, 'memefast');
});

test('default provider config selects MemeFast, not MuAPI', () => {
    installLocalStorage();

    assert.equal(loadProviderConfig().selectedProviderId, 'memefast');
    assert.equal(loadProviderConfig().providerDefaults.memefast['text:chat'][0], 'memefast:gemini-3.1-pro-preview');
    assert.equal(loadProviderConfig().providerDefaults.memefast['text:responses'][0], 'memefast:gemini-3.1-pro-preview');
    assert.equal(loadProviderConfig().providerDefaults.memefast['text:analysis'][0], 'memefast:gemini-3.1-pro-preview');
    assert.ok(loadProviderConfig().providers.some((provider) => provider.id === 'volcengine'));
    assert.equal(loadProviderConfig().providerDefaults.volcengine['video:t2v'][0], 'volcengine:doubao-seedance-2-0-260128');
    assert.equal(loadProviderConfig().providerDefaults.volcengine['video:i2v'][0], 'volcengine:doubao-seedance-2-0-260128');
});

test('legacy provider config is normalized with Volcengine Ark provider', () => {
    installLocalStorage();
    writeConfig();

    const config = loadProviderConfig();
    const provider = config.providers.find((item) => item.id === 'volcengine');

    assert.equal(provider.platform, 'volcengine');
    assert.equal(provider.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3');
    assert.deepEqual(provider.models, [
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
    ]);
});

test('selectedProviderId=volcengine routes official Seedance 2.0 video without provider fallback', () => {
    installLocalStorage();
    writeConfig({
        selectedProviderId: 'volcengine',
        providerDefaults: {
            volcengine: {
                'video:t2v': ['volcengine:doubao-seedance-2-0-260128'],
                'video:i2v': ['volcengine:doubao-seedance-2-0-260128'],
            },
        },
    });

    assert.equal(resolveGenerationTarget({ mediaType: 'video', operation: 't2v' }).providerId, 'volcengine');
    assert.equal(resolveGenerationTarget({ mediaType: 'video', operation: 't2v' }).modelId, 'doubao-seedance-2-0-260128');
    assert.equal(resolveGenerationTarget({ mediaType: 'video', operation: 'i2v', modelId: 'doubao-seedance-2-0-fast-260128-i2v' }).providerId, 'volcengine');
    assert.throws(
        () => resolveGenerationTarget({ mediaType: 'image', operation: 't2i' }),
        /No model configured for image:t2i under volcengine/,
    );
    assert.throws(
        () => resolveGenerationTarget({ mediaType: 'text', operation: 'chat' }),
        /No model configured for text:chat under volcengine/,
    );
});

test('Volcengine Seedance 2.0 adapter builds official Ark request body and rejects unsupported media', async () => {
    assert.throws(
        () => volcengineAdapter.buildRequestPlan({
            selectedProviderId: 'volcengine',
            mediaType: 'image',
            operation: 't2i',
            modelId: 'doubao-seedance-2-0-260128',
            prompt: 'x',
        }),
        /only supports video generation/,
    );

    const plan = volcengineAdapter.buildRequestPlan({
        selectedProviderId: 'volcengine',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'doubao-seedance-2-0-fast-260128-i2v',
        prompt: 'make it move',
        audio: true,
        inputs: {
            imageUrl: 'https://example.com/first.png',
            referenceImages: ['https://example.com/first.png', 'https://example.com/ref.png'],
            aspectRatio: '9:16',
            duration: 16,
            resolution: '1080p',
            watermark: false,
        },
    });

    assert.equal(plan.family, 'volcengine_seedance20');
    assert.equal(plan.endpointPath, '/contents/generations/tasks');
    assert.equal(plan.modelId, 'doubao-seedance-2-0-fast-260128');
    assert.equal(plan.body.model, 'doubao-seedance-2-0-fast-260128');
    assert.equal(plan.body.duration, 15);
    assert.equal(plan.body.resolution, '720p');
    assert.equal(plan.body.ratio, '9:16');
    assert.equal(plan.body.generate_audio, true);
    assert.deepEqual(plan.body.content.map((item) => item.type), ['text', 'image_url', 'image_url']);
    assert.equal(plan.body.content[1].role, 'first_frame');
    assert.equal(plan.body.content[2].role, 'reference_image');

    let submittedUrl = '';
    let submittedBody = null;
    const submitResult = await volcengineAdapter.submit(plan, {
        apiKey: 'volc-key',
        apiKeys: ['volc-key'],
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        submitFetch: async (url, init) => {
            submittedUrl = String(url);
            submittedBody = JSON.parse(init.body);
            assert.equal(init.headers.Authorization, 'Bearer volc-key');
            return new Response(JSON.stringify({ id: 'task-1', status: 'queued' }), { status: 200 });
        },
    });

    assert.equal(submittedUrl, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
    assert.equal(submittedBody.model, 'doubao-seedance-2-0-fast-260128');
    assert.equal(submitResult.providerId, 'volcengine');
    assert.equal(submitResult.providerTaskId, 'task-1');
    assert.equal(submitResult.status, 'queued');
});

test('Volcengine Seedance 2.0 poll parses official video url response', async () => {
    const result = await volcengineAdapter.poll({
        providerTaskId: 'task-1',
    }, {
        apiKey: 'volc-key',
        apiKeys: ['volc-key'],
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        pollFetch: async (url, init) => {
            assert.equal(String(url), 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-1');
            assert.equal(init.headers.Authorization, 'Bearer volc-key');
            return new Response(JSON.stringify({
                status: 'succeeded',
                content: { video_url: 'https://cdn.example.com/out.mp4' },
            }), { status: 200 });
        },
    });

    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.urls, ['https://cdn.example.com/out.mp4']);
});

test('legacy browser provider config migrates MuAPI default to MemeFast', () => {
    installLocalStorage();
    localStorage.setItem('genai_provider_config', JSON.stringify({
        schemaVersion: 1,
        selectedProviderId: 'muapi',
    }));

    assert.equal(loadProviderConfig().selectedProviderId, 'memefast');
});

test('schema v3 browser config migrates stale MuAPI default once while keeping v4 manual switching', () => {
    installLocalStorage();
    localStorage.setItem('genai_provider_config', JSON.stringify({
        schemaVersion: 3,
        selectedProviderId: 'muapi',
    }));
    assert.equal(loadProviderConfig().selectedProviderId, 'memefast');

    localStorage.setItem('genai_provider_config', JSON.stringify({
        schemaVersion: 4,
        selectedProviderId: 'muapi',
    }));
    assert.equal(loadProviderConfig().selectedProviderId, 'muapi');
});

test('silent fallback to MuAPI is forbidden for normal media requests', () => {
    installLocalStorage();
    writeConfig({
        providerDefaults: {
            memefast: {
                'image:t2i': ['muapi:flux-pro'],
            },
        },
    });

    assert.throws(
        () => resolveGenerationTarget({ mediaType: 'image', operation: 't2i' }),
        /Silent provider fallback is forbidden/
    );
});

test('model inventory sync keeps stale models instead of deleting', () => {
    const before = {
        memefast: {
            old_video: {
                providerId: 'memefast',
                modelId: 'old_video',
                mediaTypes: ['video'],
                source: ['snapshot'],
                visibility: { currentKeys: 'visible', staleSince: null },
                lifecycle: { state: 'active' },
            },
        },
    };
    const beforeSummary = summarizeInventory(before);
    const after = mergeModelInventory('memefast', [], before);
    const afterSummary = summarizeInventory(after);

    assertNoModelRetentionLoss(beforeSummary, afterSummary);
    assert.equal(after.memefast.old_video.lifecycle.state, 'stale');
    assert.equal(after.memefast.old_video.visibility.currentKeys, 'not_visible');
});

test('same id across providers remains provider-scoped', () => {
    const snapshot = mergeModelInventory('memefast', [{
        providerId: 'memefast',
        modelId: 'flux-pro',
        mediaTypes: ['image'],
        source: ['test'],
        visibility: { currentKeys: 'visible' },
        lifecycle: { state: 'active' },
    }], {});
    const next = mergeModelInventory('muapi', [{
        providerId: 'muapi',
        modelId: 'flux-pro',
        mediaTypes: ['image'],
        source: ['legacy-muapi'],
        visibility: { currentKeys: 'visible' },
        lifecycle: { state: 'active' },
    }], snapshot);

    assert.ok(next.memefast['flux-pro']);
    assert.ok(next.muapi['flux-pro']);
    assert.notEqual(next.memefast['flux-pro'].source[0], next.muapi['flux-pro'].source[0]);
});

test('same idempotency key and request hash reuses task', async () => {
    installLocalStorage();
    writeConfig();
    localStorage.setItem('genai_key_memefast', 'test-key');
    let submits = 0;
    const fakeFetch = async () => {
        submits += 1;
        return new Response(JSON.stringify({ id: 'provider-task-1', status: 'queued' }), { status: 200 });
    };
    const request = {
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'doubao-seedream-5-0-260128',
        prompt: 'x',
        idempotencyKey: 'same-key',
    };

    const first = await submitGenerationRequest(request, {
        idempotencyKey: 'same-key',
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch: fakeFetch, pollFetch: fakeFetch },
    });
    const second = await submitGenerationRequest(request, {
        idempotencyKey: 'same-key',
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch: fakeFetch, pollFetch: fakeFetch },
    });

    assert.equal(first.taskId, second.taskId);
    assert.equal(submits, 1);
});

test('unknown MemeFast model does not execute from guessed request plan', async () => {
    installLocalStorage();
    writeConfig();
    await assert.rejects(
        () => submitGenerationRequest({
            selectedProviderId: 'memefast',
            mediaType: 'video',
            operation: 'i2v',
            modelId: 'totally-unknown-future-model',
            prompt: 'x',
            inputs: { imageUrl: 'https://example.com/a.png' },
        }, {
            credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
            transport: { submitFetch: async () => new Response('{}', { status: 200 }) },
        }),
        /No MemeFast family/
    );
});

test('OpenAI Sora UI model aliases submit through MemeFast normalized model id', async () => {
    installLocalStorage();
    writeConfig();
    let submittedUrl = '';
    let submittedBody = null;
    const submitFetch = async (url, init) => {
        submittedUrl = String(url);
        submittedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 'provider-task-sora', status: 'queued' }), { status: 200 });
    };

    const result = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'openai-sora-2-text-to-video',
        prompt: 'x',
        idempotencyKey: `sora-alias-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.equal(result.providerId, 'memefast');
    assert.ok(submittedUrl.endsWith('/v1/videos'));
    assert.equal(submittedBody.model, 'sora-2');
});

test('MemeFast Sora official and reverse variants use distinct Moyin routes', () => {
    const official = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'sora-2',
        prompt: 'x',
        inputs: {
            aspect_ratio: '9:16',
            duration: 4,
            resolution: '720p',
        },
    });
    assert.equal(official.endpointPath, '/v1/videos');
    assert.equal(official.body.seconds, '4');
    assert.equal(official.body.size, '720x1280');

    const reverse = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'sora-2-all',
        prompt: 'x',
        inputs: {
            aspect_ratio: '9:16',
            duration: 10,
            resolution: '720p',
        },
    });
    assert.equal(reverse.endpointPath, '/v1/video/create');
    assert.equal(reverse.body.orientation, 'portrait');
    assert.equal(reverse.body.size, 'small');

    assert.throws(
        () => buildMemefastRequestPlan({
            selectedProviderId: 'memefast',
            mediaType: 'video',
            operation: 't2v',
            modelId: 'sora-2-pro-all',
            prompt: 'x',
            inputs: {
                duration: 25,
                resolution: '1080p',
            },
        }),
        /25s only supports 720p/
    );
});

test('MemeFast video family adapters follow Moyin family-specific routing', async () => {
    const veo = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'veo3.1-reference-to-video',
        prompt: 'x',
        inputs: {
            referenceImages: ['https://example.com/a.png', 'https://example.com/b.png'],
            aspect_ratio: '16:9',
        },
    });
    assert.equal(veo.endpointPath, '/v1/video/create');
    assert.equal(veo.body.model, 'veo3.1-components');
    assert.deepEqual(veo.body.images, ['https://example.com/a.png', 'https://example.com/b.png']);

    const viduQ3 = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'vidu-q3-turbo-video',
        prompt: 'x',
        inputs: { duration: 5, resolution: '720p', aspect_ratio: '16:9' },
    });
    assert.equal(viduQ3.endpointPath, '/ent/v2/text2video');
    assert.equal(viduQ3.body.model, 'viduq3-turbo');

    const viduQ2Pro = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'r2v',
        modelId: 'vidu-q2-pro-video',
        prompt: 'x',
        inputs: {
            referenceImages: ['https://example.com/a.png', 'https://example.com/b.png'],
        },
    });
    assert.equal(viduQ2Pro.endpointPath, '/ent/v2/reference2video');
    assert.deepEqual(viduQ2Pro.body.images, ['https://example.com/a.png', 'https://example.com/b.png']);
    assert.equal('subjects' in viduQ2Pro.body, false);

    const omni = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'r2v',
        modelId: 'omni-flash-components',
        prompt: 'x',
        inputs: {
            referenceImages: [
                'https://example.com/a.png',
                'https://example.com/b.png',
                'https://example.com/c.png',
                'https://example.com/d.png',
                'https://example.com/e.png',
            ],
            aspect_ratio: '9:16',
            duration: 10,
        },
    });
    assert.equal(omni.endpointPath, '/v1/video/create');
    assert.equal(omni.body.model, 'omni-flash-components');
    assert.equal(omni.body.images.length, 4);
    assert.equal(omni.body.aspect_ratio, '2:3');

    const grok = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'grok-imagine-text-to-video',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/a.png',
            aspect_ratio: '9:16',
        },
    });
    assert.equal(grok.endpointPath, '/v1/video/create');
    assert.equal(grok.body.model, 'grok-video-3');
    assert.equal(grok.body.aspect_ratio, '2:3');
    assert.equal(grok.body.size, '720P');
    assert.deepEqual(grok.body.images, ['https://example.com/a.png']);

    const minimax = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'minimax-video-01',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/a.png',
            referenceImages: ['https://example.com/b.png'],
        },
    });
    assert.equal(minimax.endpointPath, '/replicate/v1/models/minimax/video-01/predictions');
    assert.equal(minimax.body.input.first_frame_image, 'https://example.com/a.png');
    assert.equal(minimax.body.input.subject_reference, 'https://example.com/b.png');

    const happyHorseI2V = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'happyhorse-1.0-i2v',
        prompt: '',
        inputs: {
            image_url: 'https://example.com/a.png',
            aspect_ratio: '9:16',
            duration: 15,
            resolution: '720p',
        },
    });
    assert.equal(happyHorseI2V.endpointPath, '/alibailian/api/v1/services/aigc/video-generation/video-synthesis');
    assert.equal(happyHorseI2V.body.model, 'happyhorse-1.0-i2v');
    assert.equal(happyHorseI2V.body.input.media[0].type, 'first_frame');
    assert.equal(happyHorseI2V.body.parameters.duration, 15);
    assert.equal(happyHorseI2V.body.parameters.resolution, '720P');
    assert.equal('ratio' in happyHorseI2V.body.parameters, false);

    const happyHorseR2V = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'r2v',
        modelId: 'happyhorse-1.0-r2v',
        prompt: 'x',
        inputs: {
            referenceImages: Array.from({ length: 10 }, (_, index) => `https://example.com/ref-${index + 1}.png`),
            aspect_ratio: '3:2',
            resolution: '480p',
        },
    });
    assert.equal(happyHorseR2V.body.input.media.length, 9);
    assert.equal(happyHorseR2V.body.parameters.ratio, '16:9');
    assert.equal(happyHorseR2V.body.parameters.resolution, '1080P');
    assert.match(happyHorseR2V.warnings.join('\n'), /extra images were ignored/);

    const klingSClass = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'r2v',
        modelId: 'kling-v3-omni',
        prompt: 'make a continuous film from the board',
        inputs: {
            sclassMode: 'nine-grid-group',
            storyboardImage: 'https://example.com/board.png',
            referenceImages: ['https://example.com/character.png'],
            aspect_ratio: '9:16',
            duration: 20,
            resolution: '1080p',
        },
    });
    assert.equal(klingSClass.endpointPath, '/kling/v1/videos/omni-video');
    assert.equal(klingSClass.body.model_name, 'kling-v3-omni');
    assert.equal(klingSClass.body.duration, '15');
    assert.equal(klingSClass.body.sound, 'on');
    assert.match(klingSClass.body.prompt, /Do not output subtitles, tables, nine-grid panels/);
    assert.deepEqual(klingSClass.body.image_list, [
        { image_url: 'https://example.com/board.png' },
        { image_url: 'https://example.com/character.png' },
    ]);

    const grokSClass = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'grok-video-3-15s',
        prompt: 'make a continuous film from the board',
        audio: true,
        inputs: {
            sclassMode: 'nine-grid-group',
            storyboardImage: 'https://example.com/board.png',
            referenceImages: ['https://example.com/character.png'],
            videoRefs: ['https://example.com/ref.mp4'],
            audioRefs: ['https://example.com/ref.mp3'],
            aspect_ratio: '9:16',
            duration: 6,
        },
    });
    assert.equal(grokSClass.endpointPath, '/v1/video/create');
    assert.equal(grokSClass.body.duration, undefined);
    assert.deepEqual(grokSClass.body.images, ['https://example.com/board.png']);
    assert.match(grokSClass.body.prompt, /Grok Video 3 S-Class nine-grid adapter/);
    assert.match(grokSClass.warnings.join('\n'), /audio generation toggles/i);

    const pixverseSClass = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'pixverse-v5.5-i2v',
        prompt: 'keep the camera moving',
        inputs: {
            sclassMode: 'merged-grid',
            mergedImage: 'https://example.com/merged-grid.png',
            duration: 10,
            resolution: '720p',
        },
    });
    assert.equal(pixverseSClass.endpointPath, '/openapi/v2/video/img/generate');
    assert.equal(pixverseSClass.body.img_id, '__pixverse_upload_required_first_frame__');
    assert.match(pixverseSClass.body.prompt, /merged storyboard\/reference image/);
    assert.equal(pixverseSClass.uploadPreparation.firstFrame, 'https://example.com/merged-grid.png');

    const happyHorseSClass = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'happyhorse-1.0-i2v',
        prompt: 'turn references into a continuous film',
        inputs: {
            sclassMode: 'standard-group',
            image_url: 'https://example.com/first.png',
            referenceImages: Array.from({ length: 10 }, (_, index) => `https://example.com/ref-${index + 1}.png`),
            aspect_ratio: '9:16',
            duration: 20,
            resolution: '480p',
        },
    });
    assert.equal(happyHorseSClass.body.model, 'happyhorse-1.0-r2v');
    assert.equal(happyHorseSClass.body.input.media.length, 9);
    assert.equal(happyHorseSClass.body.input.media[0].type, 'reference_image');
    assert.equal(happyHorseSClass.body.input.media[0].url, 'https://example.com/first.png');
    assert.equal(happyHorseSClass.body.parameters.duration, 15);
    assert.equal(happyHorseSClass.body.parameters.resolution, '720P');

    assert.throws(
        () => buildMemefastRequestPlan({
            selectedProviderId: 'memefast',
            mediaType: 'video',
            operation: 't2v',
            modelId: 'runway-text-to-video',
            prompt: 'x',
        }),
        /requires a first-frame image/
    );
});

test('MemeFast PixVerse adapter pre-uploads URL references instead of using URLs as img_id', async () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'pixverse-v5.5-i2v',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/a.png',
            duration: 5,
            resolution: '720p',
        },
    });

    assert.equal(plan.endpointPath, '/openapi/v2/video/img/generate');
    assert.equal(plan.body.img_id, '__pixverse_upload_required_first_frame__');

    let uploadedUrl = '';
    const prepared = await prepareVideoPlanForSubmit(plan, {
        apiKey: 'test-key',
        baseUrl: 'https://memefast.top',
        uploadFetch: async (url) => {
            uploadedUrl = String(url);
            return new Response(JSON.stringify({ Resp: { img_id: 12345 } }), { status: 200 });
        },
    });

    assert.ok(uploadedUrl.endsWith('/openapi/v2/image/upload'));
    assert.equal(prepared.body.img_id, 12345);
});

test('MemeFast aliases resolve without model loss for Seedream and Nano Banana', () => {
    assert.equal(inferMemefastFamily({ mediaType: 'image', operation: 't2i', modelId: 'seedream-5.0' }), 'seedream');
    assert.equal(normalizeMemefastModelId('seedream-5.0', 'image', 'seedream'), 'doubao-seedream-5-0-260128');
    assert.equal(inferMemefastFamily({ mediaType: 'image', operation: 't2i', modelId: 'nano-banana' }), 'fal_image');
    assert.equal(normalizeMemefastModelId('nano-banana', 'image', 'fal_image'), 'fal-ai/nano-banana');
    assert.equal(inferMemefastFamily({ mediaType: 'image', operation: 't2i', modelId: 'nano-banana-pro' }), 'gemini_image');
    assert.equal(normalizeMemefastModelId('nano-banana-pro', 'image', 'gemini_image'), 'gemini-3-pro-image-preview');
    assert.equal(inferMemefastFamily({ mediaType: 'image', operation: 't2i', modelId: 'nano-banana-2' }), 'gemini_image');
    assert.equal(normalizeMemefastModelId('nano-banana-2', 'image', 'gemini_image'), 'gemini-3.1-flash-image-preview');
});

test('MemeFast Nano Banana 2 routes through Gemini chat image generation', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'nano-banana-2',
        prompt: 'x',
        inputs: {
            aspect_ratio: '16:9',
            resolution: '4k',
            google_search: true,
            output_format: 'png',
        },
    });

    assert.equal(plan.family, 'gemini_image');
    assert.equal(plan.modelId, 'gemini-3.1-flash-image-preview');
    assert.equal(plan.endpointPath, '/v1/chat/completions');
    assert.equal(plan.body.model, 'gemini-3.1-flash-image-preview');
    assert.equal(plan.body.image_size, '4K');
    assert.equal(plan.body.aspect_ratio, '16:9');
    assert.equal(plan.body.generation_config.image_config.image_size, '4K');
    assert.match(JSON.stringify(plan.body.messages), /Generate an image with aspect ratio 16:9/);
    assert.notEqual(plan.endpointPath, '/v1/images/generations', 'nano-banana-2 must not use OpenAI image generation');
});

test('MemeFast Nano Banana routes through Fal endpoint instead of OpenAI image generation', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'nano-banana',
        prompt: 'x',
        inputs: {
            aspect_ratio: '16:9',
            num_images: 6,
            output_format: 'webp',
        },
    });

    assert.equal(plan.family, 'fal_image');
    assert.equal(plan.modelId, 'fal-ai/nano-banana');
    assert.equal(plan.endpointPath, '/fal-ai/nano-banana');
    assert.deepEqual(plan.body, { prompt: 'x', num_images: 4, aspect_ratio: '16:9' });
    assert.notEqual(plan.endpointPath, '/v1/images/generations', 'nano-banana must not use OpenAI image generation');
});

test('MemeFast Nano Banana submit and poll use Fal request path', async () => {
    installLocalStorage();
    writeConfig();

    let submittedUrl = '';
    const polledUrls = [];
    const submitFetch = async (url, init) => {
        submittedUrl = String(url);
        const body = JSON.parse(init.body);
        assert.deepEqual(body, { prompt: 'x', num_images: 1, aspect_ratio: '1:1' });
        return new Response(JSON.stringify({ request_id: 'fal-nano-task-1', status: 'queued' }), { status: 200 });
    };
    const pollFetch = async (url) => {
        polledUrls.push(String(url));
        return new Response(JSON.stringify({
            status: 'completed',
            output: [{ url: 'https://cdn.example.com/nano.png' }],
        }), { status: 200 });
    };

    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'nano-banana',
        prompt: 'x',
        inputs: {
            aspect_ratio: '1:1',
        },
        idempotencyKey: `nano-banana-fal-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch, pollFetch },
    });

    assert.ok(submittedUrl.endsWith('/fal-ai/nano-banana'));
    assert.equal(submitted.providerTaskId, 'fal-nano-task-1');
    assert.equal(submitted.status, 'queued');

    const result = await pollGenerationTask(submitted.taskId, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { pollFetch },
    });

    assert.equal(polledUrls[0], 'https://memefast.top/fal-ai/nano-banana/requests/fal-nano-task-1');
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.urls, ['https://cdn.example.com/nano.png']);
});

test('MemeFast Nano Banana 2 submit parses Gemini chat image result immediately', async () => {
    installLocalStorage();
    writeConfig();

    let submittedUrl = '';
    const submitFetch = async (url, init) => {
        submittedUrl = String(url);
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'gemini-3.1-flash-image-preview');
        assert.equal(body.aspect_ratio, '1:1');
        assert.equal(body.image_size, '2K');
        return new Response(JSON.stringify({
            choices: [{
                message: {
                    content: [{
                        type: 'image_url',
                        image_url: { url: 'https://cdn.example.com/nano-banana-2.png' },
                    }],
                },
            }],
        }), { status: 200 });
    };

    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'nano-banana-2',
        prompt: 'x',
        inputs: {
            aspect_ratio: '1:1',
            resolution: '2k',
        },
        idempotencyKey: `nano-banana-2-gemini-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.ok(submittedUrl.endsWith('/v1/chat/completions'));
    assert.equal(submitted.providerTaskId, null);
    assert.equal(submitted.status, 'succeeded');
    assert.deepEqual(submitted.urls, ['https://cdn.example.com/nano-banana-2.png']);
});

test('MemeFast Nano Banana 2 chat markdown image result does not poll chat id', async () => {
    installLocalStorage();
    writeConfig();

    const submitFetch = async () => new Response(JSON.stringify({
        id: 'chatcmpl-nano-banana-2-done',
        choices: [{
            message: {
                content: 'Done: ![generated image](https://cdn.example.com/nano-banana-2-md.png)',
            },
        }],
    }), { status: 200 });

    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'nano-banana-2-edit',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/reference.png',
            aspect_ratio: '1:1',
            resolution: '2k',
        },
        idempotencyKey: `nano-banana-2-md-${Date.now()}-${Math.random()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.equal(submitted.providerTaskId, null);
    assert.equal(submitted.status, 'succeeded');
    assert.deepEqual(submitted.urls, ['https://cdn.example.com/nano-banana-2-md.png']);
});

test('MemeFast Nano Banana 2 chat inline image data result is returned immediately', async () => {
    installLocalStorage();
    writeConfig();

    const b64 = 'A'.repeat(128);
    const submitFetch = async () => new Response(JSON.stringify({
        id: 'chatcmpl-nano-banana-2-inline',
        choices: [{
            message: {
                content: [{
                    type: 'image',
                    data: b64,
                }],
            },
        }],
    }), { status: 200 });

    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'nano-banana-2',
        prompt: 'x',
        inputs: {
            aspect_ratio: '1:1',
            resolution: '2k',
        },
        idempotencyKey: `nano-banana-2-inline-${Date.now()}-${Math.random()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.equal(submitted.providerTaskId, null);
    assert.equal(submitted.status, 'succeeded');
    assert.deepEqual(submitted.urls, [`data:image/png;base64,${b64}`]);
});

test('MemeFast Nano Banana 2 chat response without image output fails instead of polling chat id', async () => {
    installLocalStorage();
    writeConfig();

    const submitFetch = async () => new Response(JSON.stringify({
        id: 'chatcmpl-nano-banana-2-no-image',
        choices: [{
            message: {
                content: 'The image is complete but no URL was returned.',
            },
        }],
    }), { status: 200 });

    await assert.rejects(
        () => submitGenerationRequest({
            selectedProviderId: 'memefast',
            mediaType: 'image',
            operation: 't2i',
            modelId: 'nano-banana-2',
            prompt: 'x',
            inputs: {
                aspect_ratio: '1:1',
                resolution: '2k',
            },
            idempotencyKey: `nano-banana-2-no-image-${Date.now()}-${Math.random()}`,
        }, {
            credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
            transport: { submitFetch },
        }),
        /MemeFast non-polling response did not contain a result URL/
    );
});

test('MemeFast request plan preserves frontend image model parameters', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'flux-kontext-pro-t2i',
        prompt: 'x',
        inputs: {
            aspect_ratio: '16:9',
            width: 1280,
            height: 720,
            num_images: 2,
            seed: 42,
            guidance_scale: 3.5,
            output_format: 'webp',
            google_search: true,
        },
    });

    const body = plan.body.input || plan.body;
    assert.equal(body.width, 1280);
    assert.equal(body.height, 720);
    assert.equal(body.num_images || body.num_outputs, 2);
    assert.equal(body.seed, 42);
    assert.equal(body.guidance_scale, 3.5);
    assert.equal(body.output_format, 'webp');
    assert.equal(body.google_search, true);
});

test('MemeFast request plan preserves frontend video model parameters', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'seedance-v2.0-i2v',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/start.png',
            last_image: 'https://example.com/end.png',
            request_id: 'extend-task-1',
            duration: 8,
            resolution: '1080p',
            camera_fixed: true,
            generate_audio: true,
        },
    });

    assert.equal(plan.body.req_id, 'extend-task-1');
    assert.equal(plan.body.duration, 8);
    assert.equal(plan.body.resolution, '1080p');
    assert.equal('camera_fixed' in plan.body, false);
    assert.match(plan.body.content[0].text, /--camera_fixed true/);
    assert.equal(plan.body.generate_audio, true);
    assert.equal(plan.body.content.filter((item) => item.type === 'image_url').length, 2);
});

test('MemeFast request plan preserves frontend audio model parameters', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'audio',
        operation: 'music',
        modelId: 'suno-create-music',
        prompt: 'song',
        inputs: {
            title: 'Title',
            style: 'pop',
            instrumental: true,
            negative_tags: 'noise',
            persona_id: 'persona-1',
            continue_at: 12,
        },
    });

    assert.equal(plan.body.title, 'Title');
    assert.equal(plan.body.tags, 'pop');
    assert.equal(plan.body.make_instrumental, true);
    assert.equal(plan.body.negative_tags, 'noise');
    assert.equal(plan.body.persona_id, 'persona-1');
    assert.equal(plan.body.continue_at, 12);
});

test('MemeFast request plan preserves frontend audio speech parameters without Suno misrouting', () => {
    const speechPlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'audio',
        operation: 'tts',
        modelId: 'minimax-speech-2.6-hd',
        prompt: 'voiceover',
        inputs: {
            voice_id: 'English_magnetic_voiced_man',
            speed: 1.1,
            volume: 1.2,
            pitch: 0,
            emotion: 'happy',
            english_normalization: true,
            sample_rate: 32000,
            bitrate: 128000,
            channel: 1,
            format: 'mp3',
            language_boost: 'auto',
        },
    });

    assert.equal(speechPlan.family, 'audio');
    assert.equal(speechPlan.endpointPath, '/minimax/v1/t2a_v2');
    assert.equal(speechPlan.body.voice_id, 'English_magnetic_voiced_man');
    assert.equal(speechPlan.body.speed, 1.1);
    assert.equal(speechPlan.body.english_normalization, true);
    assert.equal(speechPlan.body.language_boost, 'auto');

    assert.throws(
        () => buildMemefastRequestPlan({
            selectedProviderId: 'memefast',
            mediaType: 'audio',
            operation: 'tts',
            modelId: 'minimax-voice-clone',
            prompt: 'preview',
            inputs: {
                audio_url: 'https://example.com/voice.wav',
                custom_voice_id: 'voice001a',
                model: 'speech-2.6-hd',
                need_noise_reduction: true,
                need_volume_normalization: true,
                accuracy: 0.7,
            },
        }),
        /voice clone endpoint is not verified/
    );
});

test('MemeFast request plan deduplicates media aliases before provider submission', () => {
    const imagePlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'nano-banana-edit',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/a.png',
            imageUrl: 'https://example.com/a.png',
        },
    });
    assert.deepEqual(imagePlan.body.image_urls, ['https://example.com/a.png']);

    const seedancePlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'doubao-seedance-1-0-pro-250528',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/a.png',
            imageUrl: 'https://example.com/a.png',
            firstFrame: 'https://example.com/a.png',
            last_image: 'https://example.com/b.png',
            lastFrame: 'https://example.com/b.png',
        },
    });
    const imageUrls = seedancePlan.body.content
        .filter((item) => item.type === 'image_url')
        .map((item) => item.image_url.url);
    assert.deepEqual(imageUrls, ['https://example.com/a.png', 'https://example.com/b.png']);
});

test('MemeFast GPT Image inline b64_json result is returned as a display data URL', async () => {
    installLocalStorage();
    writeConfig();
    const b64 = 'A'.repeat(128);
    const submitFetch = async () => new Response(JSON.stringify({
        data: [{ b64_json: b64, output_format: 'png' }],
    }), { status: 200 });

    const result = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'gpt-image-2',
        prompt: 'x',
        idempotencyKey: `gpt-image-b64-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.resultArchiveStatus, 'not_started');
    assert.deepEqual(result.urls, [`data:image/png;base64,${b64}`]);
});

test('MemeFast GPT Image reference generation uses edits multipart, not JSON image_urls', async () => {
    installLocalStorage();
    writeConfig();
    const refDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'gpt-image-2-edit',
        prompt: 'x',
        inputs: {
            image_url: refDataUrl,
        },
    });
    assert.equal(plan.modelId, 'gpt-image-2');
    assert.equal(plan.endpointPath, '/v1/images/edits');

    let submittedUrl = '';
    let sawMultipartImage = false;
    const submitFetch = async (url, init) => {
        submittedUrl = String(url);
        assert.equal(init.headers['Content-Type'], undefined);
        const entries = Array.from(init.body.entries());
        sawMultipartImage = entries.some(([key, value]) => key === 'image' && value?.name === 'gpt-image-ref-1.png');
        return new Response(JSON.stringify({
            data: [{ url: 'https://cdn.example.com/out.png' }],
        }), { status: 200 });
    };

    const result = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'gpt-image-2-edit',
        prompt: 'x',
        inputs: {
            image_url: refDataUrl,
        },
        idempotencyKey: `gpt-image-edit-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.ok(submittedUrl.endsWith('/v1/images/edits'));
    assert.equal(sawMultipartImage, true);
    assert.deepEqual(result.urls, ['https://cdn.example.com/out.png']);
});

test('MemeFast GPT Image request plan follows Moyin-specific OpenAI image parameters', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'gpt-image-2',
        prompt: 'x',
        negativePrompt: 'bad anatomy',
        inputs: {
            aspect_ratio: '16:9',
            resolution: '4K',
            num_images: 2,
            output_format: 'webp',
            output_compression: 80,
            background: 'transparent',
            moderation: 'low',
            width: 1280,
            height: 720,
            guidance_scale: 3.5,
        },
    });

    assert.equal(plan.endpointPath, '/v1/images/generations');
    assert.equal(plan.body.size, '3840x2160');
    assert.equal(plan.body.quality, 'high');
    assert.equal(plan.body.output_format, 'webp');
    assert.equal('format' in plan.body, false);
    assert.equal(plan.body.output_compression, 80);
    assert.equal(plan.body.n, 2);
    assert.equal(plan.body.background, 'auto');
    assert.equal(plan.body.moderation, 'low');
    assert.match(plan.body.prompt, /Negative constraints: bad anatomy/);
    assert.equal('width' in plan.body, false);
    assert.equal('height' in plan.body, false);
    assert.equal('guidance_scale' in plan.body, false);
    assert.equal('negative_prompt' in plan.body, false);
    assert.equal('image_urls' in plan.body, false);

    const editPlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'gpt-image-2',
        prompt: 'x',
        inputs: {
            referenceImages: ['data:image/png;base64,' + Buffer.from('fake').toString('base64')],
            aspectRatio: '16:9',
            resolution: '4K',
            output_format: 'png',
        },
    });

    assert.equal(editPlan.endpointPath, '/v1/images/edits');
    assert.equal(editPlan.body.size, '1536x1024');
    assert.equal(editPlan.body.output_format, 'png');
    assert.equal('format' in editPlan.body, false);
    assert.equal('output_compression' in editPlan.body, false);
});

test('MemeFast request plan preserves typed frontend image and video effect parameters', () => {
    const imagePlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'qwen-image-edit-plus-lora',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/source.png',
            rotate_right_left: 0.3,
            move_forward: 0.4,
            vertical_angle: 0.5,
            wide_angle_lens: true,
        },
    });

    assert.equal(imagePlan.body.wide_angle_lens, true);
    assert.equal(imagePlan.body.rotate_right_left, 0.3);

    const videoPlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 'i2v',
        modelId: 'pixverse-v5.5-i2v',
        prompt: 'x',
        inputs: {
            image_url: 'https://example.com/source.png',
            thinking: 'enabled',
            multi_clip: true,
            shot_type: 'auto',
        },
    });

    assert.equal(videoPlan.body.thinking, 'enabled');
    assert.equal(videoPlan.body.multi_clip, true);
    assert.equal(videoPlan.body.shot_type, 'auto');
});

test('MemeFast family manifest keeps Moyin coverage families', () => {
    const expectedFamilies = [
        'image:gpt_image',
        'image:seedream',
        'image:kling_image',
        'image:flux',
        'image:flux_reference',
        'image:midjourney',
        'image:sdxl',
        'image:ideogram',
        'image:gemini_image',
        'image:fal_image',
        'image:qwen_image',
        'image:hunyuan_image',
        'image:wan_image',
        'image:vidu_image',
        'image:leonardo',
        'image:reve',
        'image:grok_image',
        'image:chroma',
        'image:recraft',
        'image:seededit',
        'image:z_image',
        'image:sora_image',
        'image:aigc_image',
        'image:dalle_image',
        'video:seedance',
        'video:omni_flash',
        'video:happyhorse',
        'video:kling',
        'video:grok',
        'video:sora',
        'video:veo',
        'video:wan',
        'video:vidu',
        'video:runway',
        'video:luma',
        'video:minimax',
        'video:pixverse',
        'text:text',
        'audio:suno',
        'audio:audio',
    ];
    const evidence = listMemefastRequestPlanEvidence();
    const proven = new Set(evidence.provenFamilies);
    for (const family of expectedFamilies) {
        assert.ok(proven.has(family), `${family} missing from MemeFast request-plan evidence`);
    }
});

test('static MemeFast inventory retains all current UI media models and text models', () => {
    const records = buildStaticMemefastInventory();
    const snapshot = mergeModelInventory('memefast', records, {});
    const summary = summarizeInventory(snapshot).memefast;

    assert.equal(records.length, 284);
    assert.equal(summary.total, 281);
    assert.ok(summary.byMediaType.image >= 109);
    assert.ok(summary.byMediaType.video >= 140);
    assert.ok(summary.byMediaType.audio >= 12);
    assert.ok(summary.byMediaType.text >= 16);
});

test('provider-scoped API key allows MemeFast without MuAPI key', () => {
    installLocalStorage();
    writeConfig();
    localStorage.setItem('genai_key_memefast', 'mf-test-key');

    assert.equal(getProviderApiKey('memefast'), 'mf-test-key');
    assert.equal(getProviderApiKey('muapi'), '');
});

test('HappyHorse submit response output.task_id is retained for polling', async () => {
    installLocalStorage();
    writeConfig();

    let submittedUrl = '';
    const submitFetch = async (url) => {
        submittedUrl = String(url);
        return new Response(JSON.stringify({ output: { task_id: 'happyhorse-task-1' } }), { status: 200 });
    };

    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'video',
        operation: 't2v',
        modelId: 'happyhorse-1.0-t2v',
        prompt: 'x',
        idempotencyKey: `happyhorse-submit-${Date.now()}`,
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch },
    });

    assert.ok(submittedUrl.endsWith('/alibailian/api/v1/services/aigc/video-generation/video-synthesis'));
    assert.equal(submitted.providerTaskId, 'happyhorse-task-1');
    assert.equal(submitted.status, 'queued');
});

test('polling uses submitted task provider and rejects wrong provider credentials', async () => {
    installLocalStorage();
    writeConfig();
    const submitFetch = async () => new Response(JSON.stringify({ id: 'provider-task-2', status: 'queued' }), { status: 200 });
    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'doubao-seedream-5-0-260128',
        prompt: 'x',
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch, pollFetch: submitFetch },
    });

    await assert.rejects(
        () => pollGenerationTask(submitted.taskId, {
            provider: { id: 'muapi', baseUrl: 'https://api.muapi.ai' },
            credentials: { apiKey: 'wrong-key', apiKeys: ['wrong-key'] },
            transport: { pollFetch: submitFetch },
        }),
        /provider_mismatch|Polling provider must match/
    );
});

test('provider polling returns final urls for queued MemeFast task', async () => {
    installLocalStorage();
    writeConfig();
    const submitFetch = async () => new Response(JSON.stringify({ id: 'provider-task-3', status: 'queued' }), { status: 200 });
    const pollFetch = async () => new Response(JSON.stringify({ status: 'succeeded', output: ['https://cdn.example.com/out.png'] }), { status: 200 });
    const submitted = await submitGenerationRequest({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'doubao-seedream-5-0-260128',
        prompt: 'x',
    }, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { submitFetch, pollFetch },
    });

    const result = await pollGenerationTask(submitted.taskId, {
        credentials: { apiKey: 'test-key', apiKeys: ['test-key'] },
        transport: { pollFetch },
    });

    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.urls, ['https://cdn.example.com/out.png']);
});

test('server provider control can disable MemeFast without falling back to MuAPI', () => {
    installLocalStorage();
    const serverConfig = applyProviderPatch({
        disabledProviders: [],
        selectedProviderId: 'memefast',
    }, {
        providerId: 'memefast',
        enabled: false,
    });
    writeConfig({
        selectedProviderId: serverConfig.selectedProviderId,
        disabledProviders: serverConfig.disabledProviders,
        providers: serverConfig.providers,
    });

    assert.throws(
        () => resolveGenerationTarget({
            selectedProviderId: 'memefast',
            mediaType: 'image',
            operation: 't2i',
            modelId: 'doubao-seedream-5-0-260128',
            prompt: 'x',
        }),
        /Provider memefast is disabled/
    );
});

test('server provider mode overrides client selectedProviderId unless client mode is explicit', async () => {
    const previousDefault = process.env.GENAI_DEFAULT_PROVIDER;
    const previousConfigPath = process.env.GENAI_PROVIDER_CONFIG_PATH;
    process.env.GENAI_DEFAULT_PROVIDER = 'memefast';
    process.env.GENAI_PROVIDER_CONFIG_PATH = `missing-${Date.now()}.json`;
    try {
        const serverConfig = await loadServerProviderConfig();
        const controlled = enforceServerProviderSelection({
            selectedProviderId: 'muapi',
            providerId: 'muapi',
            providerOverrideReason: 'browser override',
        }, serverConfig, 'server');

        assert.equal(serverConfig.selectedProviderId, 'memefast');
        assert.equal(controlled.selectedProviderId, 'memefast');
        assert.equal(controlled.providerId, undefined);
        assert.equal(controlled.providerOverrideReason, undefined);
    } finally {
        if (previousDefault === undefined) delete process.env.GENAI_DEFAULT_PROVIDER;
        else process.env.GENAI_DEFAULT_PROVIDER = previousDefault;
        if (previousConfigPath === undefined) delete process.env.GENAI_PROVIDER_CONFIG_PATH;
        else process.env.GENAI_PROVIDER_CONFIG_PATH = previousConfigPath;
    }
});

test('MemeFast file upload requires configured asset storage and never routes through MuAPI upload', () => {
    installLocalStorage();
    writeConfig({
        assetStorage: { mode: 'disabled' },
    });

    assert.throws(
        () => createAssetUploadIntent({
            selectedProviderId: 'memefast',
            providerId: 'memefast',
            modelId: 'sora-2',
            mediaType: 'image',
            fileName: 'input.png',
            contentType: 'image/png',
            sizeBytes: 1024,
            purpose: 'generation_input',
        }),
        (error) => ['provider_upload_unsupported', 'asset_storage_unconfigured'].includes(error.code)
    );
});

test('external asset registration rejects private and non-https URLs before provider submission', () => {
    installLocalStorage();
    writeConfig();

    assert.throws(
        () => registerExternalAssetUrl({
            selectedProviderId: 'memefast',
            providerId: 'memefast',
            modelId: 'sora-2',
            mediaType: 'image',
            url: 'http://127.0.0.1/private.png',
            purpose: 'generation_input',
        }),
        (error) => error.code === 'asset_url_rejected'
    );
});

test('result archiving validates provider URLs and does not mark unarchived URLs as stable', async () => {
    installLocalStorage();
    writeConfig({
        assetStorage: { mode: 'disabled' },
    });

    await assert.rejects(
        () => archiveProviderResultUrls({
            task: {
                internalTaskId: 'task_memefast_safe',
                providerId: 'memefast',
                modelId: 'sora-2',
                mediaType: 'video',
            },
            urls: ['https://127.0.0.1/result.mp4'],
            fetchImpl: async () => new Response(''),
        }),
        (error) => error.code === 'asset_url_rejected'
    );

    const archived = await archiveProviderResultUrls({
        task: {
            internalTaskId: 'task_memefast_pending',
            providerId: 'memefast',
            modelId: 'sora-2',
            mediaType: 'video',
        },
        urls: ['https://cdn.example.com/result.mp4'],
        fetchImpl: async () => new Response(''),
    });

    assert.equal(archived.records[0].archiveStatus, 'pending_storage');
    assert.equal(archived.stableUrls.length, 0);
});

test('server submit policy keeps Moyin-grade non-text timeout and marks transient upstream failures', () => {
    const submitRouteSource = fs.readFileSync('app/api/generation/submit/route.js', 'utf8');

    assert.match(submitRouteSource, /DEFAULT_TEXT_SUBMIT_TIMEOUT_MS\s*=\s*60_000/);
    assert.match(submitRouteSource, /DEFAULT_NON_TEXT_SUBMIT_TIMEOUT_MS\s*=\s*500_000/);
    assert.match(submitRouteSource, /mediaType\s*===\s*'text'\s*\|\|\s*mediaType\s*===\s*'chat'/);
    assert.match(submitRouteSource, /Provider submit timed out after/);
    assert.doesNotMatch(submitRouteSource, /DEFAULT_NON_TEXT_SUBMIT_TIMEOUT_MS\s*=\s*(60_000|90_000)/);

    const gatewayError = new Error('MemeFast submit failed: 502 Bad Gateway');
    gatewayError.status = 502;
    gatewayError.phase = 'submit';
    const normalizedGateway = normalizeProviderError(gatewayError);
    assert.equal(normalizedGateway.details.transient, true);
    assert.equal(normalizedGateway.details.status, 502);
    assert.equal(normalizedGateway.details.phase, 'submit');

    const timeoutError = new Error('Provider submit timed out after 500s');
    timeoutError.status = 504;
    timeoutError.transient = true;
    timeoutError.phase = 'submit';
    timeoutError.timeoutMs = 500_000;
    const normalizedTimeout = normalizeProviderError(timeoutError);
    assert.equal(normalizedTimeout.details.transient, true);
    assert.equal(normalizedTimeout.details.timeoutMs, 500_000);
});
