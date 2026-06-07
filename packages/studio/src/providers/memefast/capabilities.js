export const MEMEFAST_FAMILY_MANIFEST = Object.freeze([
    {
        family: 'gpt_image',
        adapter: 'gpt-image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'seedream',
        adapter: 'seedream-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'kling_image',
        adapter: 'kling_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'flux',
        adapter: 'flux-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'flux_reference',
        adapter: 'flux_reference-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'midjourney',
        adapter: 'midjourney-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'sdxl',
        adapter: 'sdxl-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'ideogram',
        adapter: 'ideogram-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'gemini_image',
        adapter: 'gemini_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'fal_image',
        adapter: 'fal-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'qwen_image',
        adapter: 'qwen_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'hunyuan_image',
        adapter: 'hunyuan_image-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'wan_image',
        adapter: 'wan_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'vidu_image',
        adapter: 'vidu_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'leonardo',
        adapter: 'leonardo-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'reve',
        adapter: 'reve-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i', 'edit_image'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'grok_image',
        adapter: 'grok_image-image',
        mediaType: 'image',
        operations: ['t2i', 'i2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_product',
    },
    {
        family: 'chroma',
        adapter: 'chroma-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'recraft',
        adapter: 'recraft-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'seededit',
        adapter: 'seededit-image',
        mediaType: 'image',
        operations: ['i2i', 'edit_image'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'z_image',
        adapter: 'z_image-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'sora_image',
        adapter: 'sora_image-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'aigc_image',
        adapter: 'aigc_image-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'dalle_image',
        adapter: 'dalle_image-image',
        mediaType: 'image',
        operations: ['t2i'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'seedance',
        adapter: 'seedance-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v', 'first_last_frame'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'omni_flash',
        adapter: 'omni-flash-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_product',
    },
    {
        family: 'happyhorse',
        adapter: 'happyhorse-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'kling',
        adapter: 'kling-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v', 'first_last_frame', 'v2v', 'lipsync'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'grok',
        adapter: 'grok-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_product',
    },
    {
        family: 'sora',
        adapter: 'sora-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'veo',
        adapter: 'veo-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'first_last_frame'],
        supportsBase64: true,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'wan',
        adapter: 'wan-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'lipsync'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'vidu',
        adapter: 'vidu-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v', 'first_last_frame'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'runway',
        adapter: 'runway-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'luma',
        adapter: 'luma-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'first_last_frame'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'minimax',
        adapter: 'minimax-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'pixverse',
        adapter: 'pixverse-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'r2v', 'first_last_frame'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'hunyuan',
        adapter: 'hunyuan-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'ovi',
        adapter: 'ovi-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'ltx',
        adapter: 'ltx-video',
        mediaType: 'video',
        operations: ['t2v', 'i2v', 'lipsync'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'effects',
        adapter: 'effects-video',
        mediaType: 'video',
        operations: ['i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'midjourney_video',
        adapter: 'midjourney-video',
        mediaType: 'video',
        operations: ['i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'leonardo_video',
        adapter: 'leonardo-video',
        mediaType: 'video',
        operations: ['i2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'video_tool',
        adapter: 'video-tool',
        mediaType: 'video',
        operations: ['v2v'],
        supportsBase64: false,
        requiresHostedUrl: true,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'text',
        adapter: 'openai-chat-llm',
        mediaType: 'text',
        operations: ['chat', 'text', 'responses', 'analysis', 'vision'],
        supportsBase64: false,
        requiresHostedUrl: false,
        officialCapabilityStatus: 'confirmed_api',
    },
    {
        family: 'suno',
        adapter: 'suno-music',
        mediaType: 'audio',
        operations: ['music', 'lyrics'],
        supportsBase64: false,
        requiresHostedUrl: null,
        officialCapabilityStatus: 'provider_claimed_only',
    },
    {
        family: 'audio',
        adapter: 'audio-pool',
        mediaType: 'audio',
        operations: ['tts'],
        supportsBase64: null,
        requiresHostedUrl: null,
        officialCapabilityStatus: 'unknown',
    },
    {
        family: 'tool',
        adapter: 'tool-pool',
        mediaType: 'tool',
        operations: ['tool'],
        supportsBase64: null,
        requiresHostedUrl: null,
        officialCapabilityStatus: 'unknown',
    },
]);

export const MEMEFAST_REQUEST_PLAN_FAMILIES = new Set(
    MEMEFAST_FAMILY_MANIFEST
        .filter((entry) => entry.mediaType !== 'tool')
        .map((entry) => `${entry.mediaType}:${entry.family}`)
);

const FAMILY_BY_KEY = new Map(MEMEFAST_FAMILY_MANIFEST.map((entry) => [`${entry.mediaType}:${entry.family}`, entry]));

function normalized(value) {
    return String(value || '').trim().toLowerCase();
}

export function listMemefastFamilyManifest() {
    return MEMEFAST_FAMILY_MANIFEST.map((entry) => ({ ...entry, operations: [...entry.operations] }));
}

export function getMemefastFamilyManifest(mediaType, family) {
    return FAMILY_BY_KEY.get(`${mediaType}:${family}`) || null;
}

function inferImageFamily(modelId, operation) {
    const id = normalized(modelId);
    if (/sora.*image/.test(id)) return 'sora_image';
    if (/seededit|seedream.*edit|bytedance-seedream.*edit|qwen-image-edit/.test(id)) return 'seededit';
    if (/gpt[-_]?image|gpt4o|dall-e-3/.test(id)) return 'gpt_image';
    if (/^(?:fal-ai\/)?nano-banana(?:\/edit|-edit)?$/.test(id)) return 'fal_image';
    if (/nano-banana|gemini|imagen|google-imagen/.test(id)) return 'gemini_image';
    if (/seedream|doubao-seedream|bytedance-seedream/.test(id)) return 'seedream';
    if (/kling.*image|kling.*text-to-image|kling.*edit-image/.test(id)) return 'kling_image';
    if (/flux.*kontext|flux.*redux|flux-2.*edit|flux.*edit|black-forest-labs|flux-kontext-apps/.test(id)) return 'flux_reference';
    if (/flux/.test(id)) return 'flux';
    if (/midjourney|mj/.test(id)) return 'midjourney';
    if (/sdxl|stable-diffusion|pony/.test(id)) return 'sdxl';
    if (/ideogram/.test(id)) return 'ideogram';
    if (/qwen|aigc-image-qwen/.test(id)) return 'qwen_image';
    if (/hunyuan/.test(id)) return 'hunyuan_image';
    if (/wan/.test(id)) return 'wan_image';
    if (/vidu/.test(id)) return 'vidu_image';
    if (/leonardo/.test(id)) return 'leonardo';
    if (/reve/.test(id)) return 'reve';
    if (/grok/.test(id)) return 'grok_image';
    if (/chroma/.test(id)) return 'chroma';
    if (/recraft/.test(id)) return 'recraft';
    if (/z-image/.test(id)) return 'z_image';
    if (/dalle|dall-e/.test(id)) return 'dalle_image';
    if (operation === 'i2i' || operation === 'edit_image') return 'flux_reference';
    return 'flux';
}

function inferVideoFamily(modelId, operation) {
    const id = normalized(modelId);
    if (/seedance|doubao-seedance/.test(id)) return 'seedance';
    if (/omni[-_ ]?flash/.test(id)) return 'omni_flash';
    if (/happyhorse/.test(id)) return 'happyhorse';
    if (/kling/.test(id)) return 'kling';
    if (/grok/.test(id)) return 'grok';
    if (/sora|openai-sora/.test(id)) return 'sora';
    if (/veo/.test(id)) return 'veo';
    if (/wan/.test(id)) return 'wan';
    if (/vidu/.test(id)) return 'vidu';
    if (/runway/.test(id)) return 'runway';
    if (/luma|ray-v[12]/.test(id)) return 'luma';
    if (/minimax|hailuo/.test(id)) return 'minimax';
    if (/pixverse/.test(id)) return 'pixverse';
    if (/hunyuan/.test(id)) return 'hunyuan';
    if (/ovi/.test(id)) return 'ovi';
    if (/ltx/.test(id)) return 'ltx';
    if (/ai-video-effects|video-effects|motion-controls|vfx|effects/.test(id)) return 'effects';
    if (/midjourney/.test(id)) return 'midjourney_video';
    if (/leonardo/.test(id)) return 'leonardo_video';
    if (/watermark-remover|video-watermark|remove-watermark/.test(id)) return 'video_tool';
    if (/infinitetalk|sync-lipsync|latentsync|creatify|veed/.test(id) || operation === 'lipsync') return 'kling';
    return null;
}

function inferAudioFamily(modelId, operation) {
    const id = normalized(modelId);
    if (/suno/.test(id) || operation === 'lyrics') return 'suno';
    return 'audio';
}

export function inferMemefastFamily({ mediaType, modelId, operation }) {
    if (mediaType === 'text') return 'text';
    if (mediaType === 'image') return inferImageFamily(modelId, operation);
    if (mediaType === 'video') return inferVideoFamily(modelId, operation);
    if (mediaType === 'audio') return inferAudioFamily(modelId, operation);
    return null;
}

export function normalizeMemefastModelId(modelId, mediaType, family) {
    const id = String(modelId || '').trim();
    const lower = id.toLowerCase();
    if (!id) return id;

    if (mediaType === 'image') {
        if (lower === 'gpt-image-2-text-to-image' || lower === 'gpt-image-2-image-to-image' || lower === 'gpt-image-2-edit') return 'gpt-image-2';
        if (lower === 'gpt-image-2-all-text-to-image' || lower === 'gpt-image-2-all-image-to-image' || lower === 'gpt-image-2-all-edit') return 'gpt-image-2-all';
        if (lower === 'seedream-5.0') return 'doubao-seedream-5-0-260128';
        if (lower === 'nano-banana') return 'fal-ai/nano-banana';
        if (lower === 'nano-banana-pro') return 'gemini-3-pro-image-preview';
        if (lower === 'nano-banana-2') return 'gemini-3.1-flash-image-preview';
        if (lower === 'nano-banana-edit') return 'fal-ai/nano-banana/edit';
        if (lower === 'nano-banana-pro-edit') return 'gemini-3-pro-image-preview';
        if (lower === 'nano-banana-2-edit') return 'gemini-3.1-flash-image-preview';
        if (lower === 'bytedance-seedream-v3') return 'doubao-seedream-3-0-t2i-250415';
        if (lower === 'bytedance-seedream-v4') return 'doubao-seedream-4-0-250828';
        if (lower === 'bytedance-seedream-v4.5') return 'doubao-seedream-4-5-251128';
        if (lower === 'bytedance-seedream-v4.5-edit') return 'doubao-seedream-4-5-251128';
        if (lower === 'seedream-5.0-edit') return 'doubao-seedream-5-0-260128';
        if (lower === 'gpt4o-text-to-image' || lower === 'gpt4o-image-to-image' || lower === 'gpt4o-edit') return 'gpt-image-1';
        if (lower === 'qwen-text-to-image-2512') return 'qwen-image-max-2512';
        if (lower === 'qwen-image-edit-2511') return 'qwen-image-edit-2509';
        if (lower === 'flux-dev') return 'fal-ai/flux-1/dev';
        if (lower === 'flux-schnell') return 'fal-ai/flux-1/schnell';
        if (lower === 'flux-dev-lora') return 'fal-ai/flux-lora';
        if (lower === 'flux-kontext-dev-t2i' || lower === 'flux-kontext-dev-i2i') return 'black-forest-labs/flux-kontext-dev';
        if (lower === 'flux-kontext-pro-t2i' || lower === 'flux-kontext-pro-i2i') return 'black-forest-labs/flux-kontext-pro';
        if (lower === 'flux-kontext-max-t2i' || lower === 'flux-kontext-max-i2i') return 'black-forest-labs/flux-kontext-max';
        if (lower === 'sdxl-image') return 'stability-ai/sdxl';
        if (lower === 'ideogram-v3-t2i') return 'ideogram_generate_v_3_default';
        if (lower === 'grok-imagine-text-to-image' || lower === 'grok-imagine-image-to-image') return 'grok-imagine-image';
    }

    if (mediaType === 'video') {
        if (lower === 'sora-2' || lower === 'sora-2-pro' || lower === 'sora-2-all' || lower === 'sora-2-pro-all' || lower === 'sora-2-vip-all') return lower;
        if (lower === 'openai-sora-2-text-to-video') return 'sora-2';
        if (lower === 'openai-sora-2-pro-text-to-video') return 'sora-2-pro';
        if (lower === 'openai-sora-2-image-to-video') return 'sora-2-all';
        if (lower === 'openai-sora-2-pro-image-to-video') return 'sora-2-pro-all';
        if (lower === 'openai-sora') return 'sora';
        if (lower === 'veo2-text-to-video') return 'veo2';
        if (lower === 'seedance-v2.0-t2v' || lower === 'seedance-v2.0-i2v') return 'doubao-seedance-2-0-260128';
        if (lower === 'seedance-lite-t2v' || lower === 'seedance-lite-i2v') return lower.includes('i2v') ? 'doubao-seedance-1-0-lite-i2v-250428' : 'doubao-seedance-1-0-lite-t2v-250428';
        if (lower === 'seedance-pro-t2v' || lower === 'seedance-pro-i2v') return lower.includes('i2v') ? 'doubao-seedance-1-0-pro-i2v-250428' : 'doubao-seedance-1-0-pro-t2v-250428';
        if (lower === 'seedance-v1.5-pro-t2v' || lower === 'seedance-v1.5-pro-i2v') return lower.includes('i2v') ? 'doubao-seedance-1-5-pro-i2v-251215' : 'doubao-seedance-1-5-pro-t2v-251215';
        if (lower === 'veo3-text-to-video' || lower === 'veo3-image-to-video') return lower.includes('image') ? 'veo3-frames' : 'veo3';
        if (lower === 'veo3-fast-text-to-video' || lower === 'veo3-fast-image-to-video') return lower.includes('image') ? 'veo3-fast-frames' : 'veo3-fast';
        if (lower === 'veo3.1-text-to-video' || lower === 'veo3.1-image-to-video') return lower.includes('image') ? 'veo3.1-components' : 'veo3.1';
        if (lower === 'veo3.1-fast-text-to-video' || lower === 'veo3.1-fast-image-to-video') return lower.includes('image') ? 'veo3.1-fast-components' : 'veo3.1-fast';
        if (lower === 'veo3.1-reference-to-video') return 'veo3.1-components';
        if (lower === 'grok-imagine-text-to-video' || lower === 'grok-imagine-image-to-video') return 'grok-video-3';
        if (lower === 'vidu-q3-turbo-video') return 'viduq3-turbo';
        if (lower === 'vidu-q3-pro-video') return 'viduq3-pro';
        if (lower === 'vidu-q2-turbo-video') return 'viduq2-turbo';
        if (lower === 'vidu-q2-video') return 'viduq2';
        if (lower === 'vidu-q2-pro-video') return 'viduq2-pro';
        if (lower === 'vidu-q1-video') return 'viduq1';
        if (lower === 'vidu-q1-classic-video') return 'viduq1-classic';
        if (lower === 'vidu-v2.0-video') return 'vidu2.0';
        if (lower === 'minimax-hailuo-02-standard-t2v' || lower === 'minimax-hailuo-02-standard-i2v') return 'MiniMax-Hailuo-02';
        if (lower === 'minimax-hailuo-02-pro-t2v' || lower === 'minimax-hailuo-02-pro-i2v') return 'MiniMax-Hailuo-02';
        if (lower === 'minimax-hailuo-2.3-pro-t2v' || lower === 'minimax-hailuo-2.3-pro-i2v') return 'MiniMax-Hailuo-2.3';
        if (lower === 'minimax-hailuo-2.3-standard-t2v' || lower === 'minimax-hailuo-2.3-standard-i2v') return 'MiniMax-Hailuo-2.3';
        if (lower === 'minimax-hailuo-2.3-fast') return 'MiniMax-Hailuo-2.3-Fast';
        if (lower === 'minimax-video-01') return 'minimax/video-01';
        if (lower === 'minimax-video-01-live') return 'minimax/video-01-live';
        if (lower === 'wan2.6-image-to-video') return 'wan2.6-i2v';
        if (lower === 'wan2.6-text-to-video') return 'wan2.6-t2v';
    }

    if (mediaType === 'audio') {
        if (family === 'suno' && !/^suno[_-]/i.test(id)) return 'suno_music';
        if (/minimax-speech|speech-2\.6/.test(lower)) return lower.includes('hd') ? 'speech-2.6-hd' : 'speech-2.6-turbo';
    }

    return id;
}

export function isMemefastRequestPlanProven(plan) {
    if (!plan?.mediaType || !plan?.family) return false;
    return MEMEFAST_REQUEST_PLAN_FAMILIES.has(`${plan.mediaType}:${plan.family}`);
}

export function listMemefastRequestPlanEvidence() {
    return {
        provenFamilies: Array.from(MEMEFAST_REQUEST_PLAN_FAMILIES),
        familyManifest: listMemefastFamilyManifest(),
    };
}
