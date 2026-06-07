import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getAspectRatiosForI2IModel,
    getAspectRatiosForModel,
} from '../../packages/studio/src/models.js';
import { buildMemefastRequestPlan } from '../../packages/studio/src/providers/memefast/request-plan.js';

const GPT_IMAGE_2_ASPECT_RATIOS = [
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '5:4',
    '4:5',
    '3:2',
    '2:3',
];

test('GPT Image 2 UI entries expose Moyin MemeFast aspect ratios', () => {
    assert.deepEqual(getAspectRatiosForModel('gpt-image-2'), GPT_IMAGE_2_ASPECT_RATIOS);
    assert.deepEqual(getAspectRatiosForModel('gpt-image-2-all'), GPT_IMAGE_2_ASPECT_RATIOS);
    assert.deepEqual(getAspectRatiosForI2IModel('gpt-image-2-edit'), GPT_IMAGE_2_ASPECT_RATIOS);
    assert.deepEqual(getAspectRatiosForI2IModel('gpt-image-2-all-edit'), GPT_IMAGE_2_ASPECT_RATIOS);
});

test('GPT Image 2 UI entries do not expose ambiguous auto aspect ratio', () => {
    for (const ratios of [
        getAspectRatiosForModel('gpt-image-2'),
        getAspectRatiosForModel('gpt-image-2-all'),
        getAspectRatiosForI2IModel('gpt-image-2-edit'),
        getAspectRatiosForI2IModel('gpt-image-2-all-edit'),
    ]) {
        assert.equal(ratios.some((ratio) => String(ratio).toLowerCase() === 'auto'), false);
    }
});

test('GPT Image 2 All UI aliases submit through the gpt-image-2-all MemeFast variant', () => {
    const textPlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'gpt-image-2-all',
        prompt: 'x',
        inputs: {
            aspect_ratio: '5:4',
            resolution: '4K',
            output_format: 'jpeg',
        },
    });

    assert.equal(textPlan.modelId, 'gpt-image-2-all');
    assert.equal(textPlan.body.model, 'gpt-image-2-all');
    assert.equal(textPlan.endpointPath, '/v1/images/generations');
    assert.equal(textPlan.body.size, '3200x2560');
    assert.equal(textPlan.body.output_format, 'jpeg');

    const editPlan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 'i2i',
        modelId: 'gpt-image-2-all-edit',
        prompt: 'x',
        inputs: {
            image_url: 'data:image/png;base64,' + Buffer.from('fake').toString('base64'),
            aspect_ratio: '2:3',
            resolution: '4K',
            output_format: 'png',
        },
    });

    assert.equal(editPlan.modelId, 'gpt-image-2-all');
    assert.equal(editPlan.body.model, 'gpt-image-2-all');
    assert.equal(editPlan.endpointPath, '/v1/images/edits');
    assert.equal(editPlan.body.size, '1024x1536');
    assert.equal(editPlan.body.output_format, 'png');
});

test('GPT Image 2 request plan normalizes stale auto aspect ratio to explicit square size', () => {
    const plan = buildMemefastRequestPlan({
        selectedProviderId: 'memefast',
        mediaType: 'image',
        operation: 't2i',
        modelId: 'gpt-image-2',
        prompt: 'x',
        inputs: {
            aspect_ratio: 'auto',
            resolution: '2K',
        },
    });

    assert.equal(plan.body.size, '2048x2048');
    assert.equal('aspect_ratio' in plan.body, false);
});
