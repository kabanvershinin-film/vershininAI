import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    createInitialModelParams,
    sanitizeModelParams,
} from '../../packages/studio/src/components/model-parameter-utils.js';
import {
    IMAGE_MODEL_MODE_PAIRS,
    resolveI2IModelForUpload,
    resolveT2IModelForClear,
} from '../../packages/studio/src/components/image-model-mode-utils.js';
import { resolveProviderPollPolicy, resumeProviderTask } from '../../packages/studio/src/muapi.js';
import {
    audioModels,
    i2iModels,
    i2vModels,
    lipsyncModels,
    studioVisibleAudioModels,
    studioVisibleI2IModels,
    studioVisibleI2VModels,
    studioVisibleLipSyncModels,
    studioVisibleT2IModels,
    studioVisibleT2VModels,
    studioVisibleV2VModels,
    t2iModels,
    t2vModels,
    v2vModels,
} from '../../packages/studio/src/models.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const ids = (models) => models.map((model) => model.id);

function assertIncludesAll(actual, expected) {
    const set = new Set(actual);
    for (const id of expected) assert.ok(set.has(id), `${id} missing`);
}

function assertExcludesAll(actual, excluded) {
    const set = new Set(actual);
    for (const id of excluded) assert.equal(set.has(id), false, `${id} should not be visible`);
}

test('studio visible models keep newest families while full inventory is retained', () => {
    assert.deepEqual(
        {
            t2i: t2iModels.length,
            i2i: i2iModels.length,
            t2v: t2vModels.length,
            i2v: i2vModels.length,
            v2v: v2vModels.length,
            lipsync: lipsyncModels.length,
            audio: audioModels.length,
        },
        { t2i: 54, i2i: 58, t2v: 65, i2v: 65, v2v: 5, lipsync: 9, audio: 12 },
    );
    assert.deepEqual(
        {
            t2i: studioVisibleT2IModels.length,
            i2i: studioVisibleI2IModels.length,
            t2v: studioVisibleT2VModels.length,
            i2v: studioVisibleI2VModels.length,
            v2v: studioVisibleV2VModels.length,
            lipsync: studioVisibleLipSyncModels.length,
            audio: studioVisibleAudioModels.length,
        },
        { t2i: 4, i2i: 4, t2v: 37, i2v: 40, v2v: 4, lipsync: 9, audio: 12 },
    );

    assertIncludesAll(ids(t2iModels), ['nano-banana', 'nano-banana-pro', 'nano-banana-2', 'gpt-image-1.5']);
    assertIncludesAll(ids(t2vModels), ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'seedance-v2.0-t2v', 'seedance-v2.0-extend', 'seedance-v1.5-pro-t2v']);
    assertIncludesAll(ids(i2vModels), ['doubao-seedance-2-0-260128-i2v', 'doubao-seedance-2-0-fast-260128-i2v', 'seedance-v2.0-i2v', 'seedance-v1.5-pro-i2v']);

    assertIncludesAll(ids(studioVisibleT2IModels), [
        'nano-banana-2',
        'seedream-5.0',
        'gpt-image-2',
        'gpt-image-2-all',
    ]);
    assertExcludesAll(ids(studioVisibleT2IModels), [
        'nano-banana',
        'nano-banana-pro',
        'gpt-image-1.5',
        'bytedance-seedream-v4.5',
        'wan2.5-text-to-image',
        'flux-2-pro',
        'wan2.6-text-to-image',
        'qwen-text-to-image-2512',
        'midjourney-v7-text-to-image',
    ]);

    assertIncludesAll(ids(studioVisibleI2IModels), [
        'nano-banana-2-edit',
        'seedream-5.0-edit',
        'gpt-image-2-edit',
        'gpt-image-2-all-edit',
    ]);
    assertExcludesAll(ids(studioVisibleI2IModels), [
        'nano-banana-edit',
        'nano-banana-pro-edit',
        'gpt-image-1.5-edit',
        'bytedance-seedream-v4.5-edit',
        'wan2.5-image-edit',
        'flux-2-pro-edit',
        'wan2.6-image-edit',
        'qwen-image-edit-2511',
        'midjourney-v7-image-to-image',
        'topaz-image-upscale',
        'seedvr2-image-upscale',
        'add-image-watermark',
        'ai-image-upscaler',
        'ai-image-face-swap',
        'ai-dress-change',
        'ai-background-remover',
        'ai-product-shot',
        'ai-skin-enhancer',
        'image-effects',
        'image-passthrough',
    ]);

    assertIncludesAll(ids(studioVisibleT2VModels), [
        'omni-flash',
        'omni-flash-components',
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
        'seedance-v1.5-pro-t2v',
        'seedance-v1.5-pro-t2v-fast',
        'kling-v3.0-pro-text-to-video',
        'veo3.1-text-to-video',
        'wan2.6-text-to-video',
        'pixverse-v5.5-t2v',
        'sora-2',
        'sora-2-pro',
    ]);
    assert.deepEqual(ids(studioVisibleT2VModels).slice(0, 2), [
        'omni-flash',
        'omni-flash-components',
    ]);
    assertExcludesAll(ids(studioVisibleT2VModels), [
        'seedance-lite-t2v',
        'seedance-pro-t2v',
        'seedance-v2.0-t2v',
        'seedance-v2.0-extend',
        'kling-v2.6-pro-t2v',
        'veo3-text-to-video',
        'wan2.5-text-to-video',
        'pixverse-v5-t2v',
        'openai-sora',
    ]);

    assertIncludesAll(ids(studioVisibleI2VModels), [
        'doubao-seedance-2-0-260128-i2v',
        'doubao-seedance-2-0-fast-260128-i2v',
        'seedance-v1.5-pro-i2v',
        'seedance-v1.5-pro-i2v-fast',
        'kling-v3.0-pro-image-to-video',
        'veo3.1-image-to-video',
        'wan2.6-image-to-video',
        'pixverse-v5.5-i2v',
        'minimax-hailuo-2.3-pro-i2v',
    ]);
    assertExcludesAll(ids(studioVisibleI2VModels), [
        'seedance-lite-i2v',
        'seedance-pro-i2v',
        'seedance-v2.0-i2v',
        'kling-v2.6-pro-i2v',
        'veo3-image-to-video',
        'wan2.5-image-to-video',
        'pixverse-v5-i2v',
    ]);
});

test('image/video/lipsync studios use dynamic model parameter controls', () => {
    const imageStudio = read('packages/studio/src/components/ImageStudio.jsx');
    const videoStudio = read('packages/studio/src/components/VideoStudio.jsx');
    const lipSyncStudio = read('packages/studio/src/components/LipSyncStudio.jsx');

    for (const [name, source] of [
        ['ImageStudio', imageStudio],
        ['VideoStudio', videoStudio],
        ['LipSyncStudio', lipSyncStudio],
    ]) {
        assert.match(source, /ModelParameterControls/);
        assert.match(source, /createInitialModelParams/);
        assert.match(source, /sanitizeModelParams\(/);
        assert.match(source, /\.\.\.sanitizedModelParams/);
    }
});

test('image model dropdown uses provider brand logos instead of first-letter badges', () => {
    const imageStudio = read('packages/studio/src/components/ImageStudio.jsx');

    assert.match(imageStudio, /react-icons\/si/);
    assert.match(imageStudio, /SiGooglegemini/);
    assert.match(imageStudio, /SiBytedance/);
    assert.match(imageStudio, /SiOpenai/);
    assert.match(imageStudio, /const\s+MODEL_BRANDS\s*=\s*\[/);
    assert.match(imageStudio, /Icon:\s*SiGooglegemini/);
    assert.match(imageStudio, /Icon:\s*SiBytedance/);
    assert.match(imageStudio, /Icon:\s*SiOpenai/);
    assert.match(imageStudio, /function\s+groupModelsByBrand/);
    assert.match(imageStudio, /function\s+ModelBrandLogo/);
    assert.match(imageStudio, /brand\.label/);
    assert.doesNotMatch(imageStudio, /m\.name\.charAt\(0\)/);
});

test('image reference uploads preserve paired model families like Moyin freedom panel', () => {
    assert.deepEqual(IMAGE_MODEL_MODE_PAIRS, [
        { t2i: 'nano-banana-2', i2i: 'nano-banana-2-edit' },
        { t2i: 'seedream-5.0', i2i: 'seedream-5.0-edit' },
        { t2i: 'gpt-image-2', i2i: 'gpt-image-2-edit' },
        { t2i: 'gpt-image-2-all', i2i: 'gpt-image-2-all-edit' },
    ]);

    assert.equal(
        resolveI2IModelForUpload('gpt-image-2', studioVisibleI2IModels)?.id,
        'gpt-image-2-edit',
    );
    assert.equal(
        resolveI2IModelForUpload('gpt-image-2-all', studioVisibleI2IModels)?.id,
        'gpt-image-2-all-edit',
    );
    assert.equal(
        resolveI2IModelForUpload('nano-banana-2', studioVisibleI2IModels)?.id,
        'nano-banana-2-edit',
    );
    assert.equal(resolveI2IModelForUpload('unknown-image-model', studioVisibleI2IModels), null);

    assert.equal(
        resolveT2IModelForClear('gpt-image-2-edit', studioVisibleT2IModels)?.id,
        'gpt-image-2',
    );
    assert.equal(
        resolveT2IModelForClear('gpt-image-2-all-edit', studioVisibleT2IModels)?.id,
        'gpt-image-2-all',
    );
    assert.equal(
        resolveT2IModelForClear('seedream-5.0-edit', studioVisibleT2IModels)?.id,
        'seedream-5.0',
    );
    assert.equal(resolveT2IModelForClear('unknown-image-edit-model', studioVisibleT2IModels), null);

    const imageStudio = read('packages/studio/src/components/ImageStudio.jsx');
    assert.doesNotMatch(imageStudio, /const\s+firstI2I\s*=\s*i2iModels\[0\]/);
    assert.doesNotMatch(imageStudio, /const\s+firstT2I\s*=\s*t2iModels\[0\]/);
});

test('image studio immediately persists generated history before tab unmount', () => {
    const imageStudio = read('packages/studio/src/components/ImageStudio.jsx');

    assert.match(imageStudio, /const\s+localHistoryRef\s*=\s*useRef\(\[\]\)/);
    assert.match(imageStudio, /const\s+currentImageRef\s*=\s*useRef\(null\)/);
    assert.match(imageStudio, /IMAGE_HISTORY_DB_NAME/);
    assert.match(imageStudio, /function\s+isInlineImageDataUrl/);
    assert.match(imageStudio, /async function\s+persistImageHistoryEntry/);
    assert.match(imageStudio, /async function\s+hydratePersistedImageHistory/);
    assert.match(imageStudio, /localHistoryRef\.current\s*=\s*hydratedHistory/);
    assert.match(imageStudio, /currentImage:\s*serializeImageHistoryEntry\(currentImageRef\.current\)/);
    assert.match(imageStudio, /currentImageRef\.current\s*=\s*hydratedCurrentImage/);
    assert.match(imageStudio, /const\s+nextHistory\s*=\s*\[persistedEntry,\s*\.\.\.localHistoryRef\.current\.slice\(0,\s*49\)\]/);
    assert.match(imageStudio, /const\s+persistedEntry\s*=\s*await\s+persistImageHistoryEntry\(entry\)/);
    assert.match(imageStudio, /localHistory:\s*nextHistory\.map\(serializeImageHistoryEntry\)/);
    assert.match(imageStudio, /currentImage:\s*serializeImageHistoryEntry\(persistedEntry\)/);
    assert.match(imageStudio, /Failed to immediately save ImageStudio history/);
    assert.doesNotMatch(imageStudio, /localHistory:\s*localHistoryRef\.current,\s*\n\s*modelParams/);
});

test('image studio keeps a Moyin-style active execution window across tab switches', () => {
    const imageStudio = read('packages/studio/src/components/ImageStudio.jsx');
    const shell = read('components/StandaloneShell.js');

    assert.equal(typeof resumeProviderTask, 'function');
    assert.match(imageStudio, /const\s+IMAGE_GENERATION_STALE_MS\s*=/);
    assert.match(imageStudio, /function\s+createImageGenerationExecution/);
    assert.match(imageStudio, /function\s+serializeActiveGeneration/);
    assert.match(imageStudio, /function\s+isRunnableImageGenerationExecution/);
    assert.match(imageStudio, /const\s+\[activeGeneration,\s*setActiveGeneration\]\s*=\s*useState\(null\)/);
    assert.match(imageStudio, /const\s+activeGenerationRef\s*=\s*useRef\(null\)/);
    assert.match(imageStudio, /activeGeneration:\s*serializeActiveGeneration\(activeGenerationRef\.current\)/);
    assert.match(imageStudio, /setActiveGenerationStatus\(\{\s*status:\s*"running"/);
    assert.match(imageStudio, /const\s+onRequestId\s*=\s*\(requestId\)\s*=>/);
    assert.match(imageStudio, /onRequestId,/);
    assert.match(imageStudio, /resumeImageGenerationTask/);
    assert.match(imageStudio, /resumeProviderTask\(/);
    assert.match(imageStudio, /ImageGenerationExecutionPanel/);
    assert.match(imageStudio, /任务执行/);
    assert.match(imageStudio, /生成中/);
    assert.match(imageStudio, /继续等待结果/);
    assert.match(shell, /const\s+studioPaneClass/);
    assert.match(shell, /activeTab\s*===\s*'image'\s*\?\s*droppedFiles\s*:\s*null/);
    assert.doesNotMatch(shell, /\{activeTab\s*===\s*'image'\s*&&\s*<ImageStudio/);
});

test('provider layer gives slow GPT Image 2 family enough image polling time', () => {
    assert.deepEqual(
        resolveProviderPollPolicy({
            mediaType: 'image',
            modelId: 'gpt-image-2-all-edit',
        }),
        {
            maxAttempts: 250,
            interval: 2000,
        },
    );
    assert.deepEqual(
        resolveProviderPollPolicy({
            mediaType: 'image',
            modelId: 'seedream-5.0',
        }),
        {
            maxAttempts: 120,
            interval: 2000,
        },
    );
    assert.deepEqual(
        resolveProviderPollPolicy({
            mediaType: 'video',
            modelId: 'sora-2',
        }),
        {
            maxAttempts: 180,
            interval: 5000,
        },
    );
});

test('video model dropdown uses provider brand logos instead of first-letter badges', () => {
    const videoStudio = read('packages/studio/src/components/VideoStudio.jsx');

    assert.match(videoStudio, /react-icons\/si/);
    assert.match(videoStudio, /SiBytedance/);
    assert.match(videoStudio, /SiKuaishou/);
    assert.match(videoStudio, /SiOpenai/);
    assert.match(videoStudio, /const\s+VIDEO_MODEL_BRANDS\s*=\s*\[/);
    assert.match(videoStudio, /function\s+groupVideoModelsByBrand/);
    assert.match(videoStudio, /function\s+VideoBrandLogo/);
    assert.match(videoStudio, /selectedModelBrand/);
    assert.match(videoStudio, /VideoBrandLogo brand=\{selectedModelBrand\}/);
    assert.match(videoStudio, /VIDEO_PERSIST_SCHEMA_VERSION/);
    assert.match(videoStudio, /LEGACY_DEFAULT_T2V_MODEL_IDS/);
    assert.match(videoStudio, /seedance-v1\.5-pro-t2v/);
    assert.match(videoStudio, /shouldMigrateLegacyDefault/);
    assert.doesNotMatch(videoStudio, /m\.name\.charAt\(0\)/);
});

test('all model aspect ratio controls use explicit ratios instead of auto', () => {
    const groups = [t2iModels, i2iModels, t2vModels, i2vModels, v2vModels];
    for (const models of groups) {
        for (const model of models) {
            const schema = model.inputs?.aspect_ratio;
            if (!schema) continue;
            assert.notEqual(String(schema.default || '').toLowerCase(), 'auto', `${model.id} default aspect_ratio is auto`);
            for (const option of schema.enum || []) {
                assert.notEqual(String(option).toLowerCase(), 'auto', `${model.id} exposes auto aspect_ratio`);
            }
            assert.notEqual(
                createInitialModelParams(model, { aspect_ratio: 'auto' }).aspect_ratio,
                'auto',
                `${model.id} retained stale auto aspect_ratio`,
            );
            assert.equal(
                'aspect_ratio' in sanitizeModelParams({ aspect_ratio: 'auto' }, model),
                false,
                `${model.id} submitted stale auto aspect_ratio`,
            );
        }
    }
});

test('image model params retain known non-primary schema fields', () => {
    const skip = [
        'prompt',
        'aspect_ratio',
        'resolution',
        'quality',
        'image_url',
        'images_list',
        'name',
        'api_key',
    ];

    const midjourney = t2iModels.find((m) => m.id === 'midjourney-v7-text-to-image');
    const nanoBanana = t2iModels.find((m) => m.id === 'nano-banana-2');
    assert.ok(midjourney);
    assert.ok(nanoBanana);

    assert.deepEqual(
        Object.keys(createInitialModelParams(midjourney, {}, skip)).sort(),
        ['speed', 'stylization', 'variety', 'weirdness'].sort(),
    );
    assert.deepEqual(
        sanitizeModelParams({
            speed: 'Relax',
            variety: 55,
            stylization: 400,
            weirdness: 1200,
            aspect_ratio: '1:1',
        }, midjourney, skip),
        {
            speed: 'Relax',
            variety: 55,
            stylization: 400,
            weirdness: 1200,
        },
    );

    assert.deepEqual(
        sanitizeModelParams({
            google_search: true,
            output_format: 'png',
            prompt: 'x',
        }, nanoBanana, skip),
        {
            google_search: true,
            output_format: 'png',
        },
    );
});

test('video model params retain Moyin family fields without hardcoded fallback', () => {
    const skip = [
        'prompt',
        'aspect_ratio',
        'duration',
        'resolution',
        'quality',
        'mode',
        'name',
        'image_url',
        'video_url',
        'last_image',
        'request_id',
    ];

    const happyHorseT2V = t2vModels.find((m) => m.id === 'happyhorse-1.0-t2v');
    const seedance = i2vModels.find((m) => m.id === 'seedance-v1.5-pro-i2v');
    const vidu = i2vModels.find((m) => m.id === 'vidu-q2-pro-start-end-video');
    const pixverse = i2vModels.find((m) => m.id === 'pixverse-v5.5-i2v');
    const happyHorseV2V = v2vModels.find((m) => m.id === 'happyhorse-1.0-video-edit');

    assert.ok(happyHorseT2V);
    assert.ok(seedance);
    assert.ok(vidu);
    assert.ok(pixverse);
    assert.ok(happyHorseV2V);

    assert.deepEqual(createInitialModelParams(happyHorseT2V, {}, skip), { watermark: false });
    assert.deepEqual(
        sanitizeModelParams({ watermark: true, duration: 5 }, happyHorseV2V, skip),
        { watermark: true },
    );
    assert.deepEqual(
        sanitizeModelParams({
            generate_audio: true,
            camera_fixed: true,
            duration: 5,
        }, seedance, skip),
        {
            generate_audio: true,
            camera_fixed: true,
        },
    );
    assert.deepEqual(
        sanitizeModelParams({
            bgm: false,
            movement_amplitude: 'large',
            aspect_ratio: '16:9',
        }, vidu, skip),
        {
            bgm: false,
            movement_amplitude: 'large',
        },
    );
    assert.deepEqual(
        sanitizeModelParams({
            style: 'anime',
            thinking: 'enabled',
            audio: true,
            multi_clip: true,
            resolution: '720p',
        }, pixverse, skip),
        {
            style: 'anime',
            thinking: 'enabled',
            audio: true,
            multi_clip: true,
        },
    );
});
