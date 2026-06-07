# Provider Supported Models Audit

Generated from local code on 2026-06-06.

## Conclusion

Default provider is now `memefast`. `muapi` remains only as a manually selectable legacy provider for MuAPI-only workflow/agent/app features during migration.

There is no silent fallback from MemeFast to MuAPI. If MemeFast is selected and a model/family is unsupported, disabled, missing credentials, or rejected by MemeFast, the request fails explicitly.

The earlier narrow MemeFast allowlist was the old state and is no longer the execution model. The adapter now uses a Moyin-style family manifest plus static UI model inventory retention.

## Current Static Model Baseline

The original UI model baseline is retained:

- Static UI entries: 239
- Unique static UI model ids: 236
- Text-to-image entries: 53
- Image-to-image entries: 57
- Text-to-video entries: 43
- Image-to-video entries: 61
- Video-to-video entries: 4
- Lipsync entries: 9
- Audio entries: 12

The MemeFast static provider inventory adds text models and preserves overlapping model ids by provider scope:

- Static MemeFast inventory records: 245
- Unique MemeFast inventory model ids: 242
- Image inventory count: 107
- Video inventory count: 117
- Audio inventory count: 12
- Text inventory count: 6

## MemeFast Adapter Families

### Text

- `text`

Default text bindings use `memefast:gpt-4o-mini`. The local inventory also includes common OpenAI/Gemini/DeepSeek/Claude-compatible text ids for routing.

### Image

- `gpt_image`
- `seedream`
- `kling_image`
- `flux`
- `flux_reference`
- `midjourney`
- `sdxl`
- `ideogram`
- `gemini_image`
- `fal_image`
- `qwen_image`
- `hunyuan_image`
- `wan_image`
- `vidu_image`
- `leonardo`
- `reve`
- `grok_image`
- `chroma`
- `recraft`
- `seededit`
- `z_image`
- `sora_image`
- `aigc_image`
- `dalle_image`

Important aliases:

- `seedream-5.0` -> `doubao-seedream-5-0-260128`
- `nano-banana` -> `fal-ai/nano-banana` via `/fal-ai/nano-banana`
- `nano-banana-edit` -> `fal-ai/nano-banana/edit` via `/fal-ai/nano-banana/edit`
- `nano-banana-pro` -> `gemini-3-pro-image-preview`
- `nano-banana-2` -> `gemini-3.1-flash-image-preview`
- `bytedance-seedream-v4.5` -> `doubao-seedream-4-5-251128`
- Flux UI aliases route to Fal/Replicate-style ids where needed.

### Video

- `seedance`
- `omni_flash`
- `happyhorse`
- `kling`
- `grok`
- `sora`
- `veo`
- `wan`
- `vidu`
- `runway`
- `luma`
- `minimax`
- `pixverse`
- `hunyuan`
- `ovi`
- `ltx`
- `effects`
- `midjourney_video`
- `leonardo_video`
- `video_tool`

Important aliases:

- `openai-sora-2-text-to-video` -> `sora-2`
- `openai-sora-2-image-to-video` -> `sora-2`
- `openai-sora-2-pro-text-to-video` -> `sora-2-pro`
- `openai-sora-2-pro-image-to-video` -> `sora-2-pro`
- `seedance-v2.0-t2v` / `seedance-v2.0-i2v` -> `doubao-seedance-2-0-260128`

### Audio

- `suno`
- `audio`

The Suno family routes music/lyrics through `/suno/submit/*`; speech-style audio routes through OpenAI-compatible or MiniMax-style audio endpoints.

`minimax-voice-clone` is retained in the model inventory but is explicitly blocked from execution until a MemeFast voice-clone endpoint is verified. It must not be routed through the generic MiniMax TTS endpoint.

## Upload And Result Display Boundary

Frontend uploads only to this app server or registers an external HTTPS asset URL. MemeFast input assets use `object_storage_url`; MuAPI native upload is not used for MemeFast.

Provider result URLs are returned to the frontend task result. If result archiving/object storage is configured, stable archived URLs are preferred. If storage is disabled, provider URLs are still exposed as provider URLs and marked as pending storage instead of pretending they are permanent.

## Runtime Guardrails

- Default config: `selectedProviderId: 'memefast'`
- Silent fallback flag: `allowSilentProviderFallback: false`
- Submit endpoint default credential provider: `memefast`
- Provider sync always merges static MemeFast inventory before remote `/api/pricing_new` or `/v1/models`.
- Remote sync cannot delete or stale the local static MemeFast baseline.
- `scripts/audit-provider-model-retention.mjs` fails if any of the 239 static UI entries cannot map to a MemeFast family.
- The same audit builds MemeFast request plans for all current frontend model inputs and fails if a non-ignored input key is not retained in the provider request body.
- The audit now also fails on duplicate media references caused by frontend field aliases and verifies that `minimax-voice-clone` is not silently routed through generic TTS.
- `scripts/guards/no-provider-fallback.mjs` fails if default provider is changed back to MuAPI.

## Frontend Parameter Retention

The frontend facade now normalizes common field aliases before the provider layer:

- `negative_prompt` -> `negativePrompt`
- `generate_audio` -> `audio`
- `last_image` / `last_image_url` / `end_image_url` -> `lastFrame`
- `video_files` -> `videoUrls`
- `audios_list` -> `audioUrls`
- `request_id` -> `requestId`

The MemeFast request planner consumes the current static model input fields for image, video, lipsync, and audio models. The current permanent audit covers 582 frontend model input fields. Parameter coverage includes:

- Image: `width`, `height`, `num_images`, `resolution`, `quality`, `style`, `strength`, `seed`, `guidance_scale`, `output_format`, `render_speed`, `google_search`, `watermark`, `prompt_extend`, `variety`, `stylization`, `weirdness`, effect and placement fields.
- Video: `aspect_ratio`, `duration`, `resolution`, `quality`, `mode`, `request_id`, `camera_fixed`, `generate_audio`, `remove_watermark`, `bgm`, `sound`, `keep_original_sound`, `movement_amplitude`, `num_videos`, `effect_name`, `go_fast`, and first/last-frame fields.
- Audio: Suno custom fields (`custom_mode`, `instrumental`, `negative_tags`, `persona_id`, `continue_at`) plus TTS/voice fields (`voice_id`, `speed`, `volume`, `pitch`, `emotion`, `language_boost`, `sample_rate`, `format`, `need_noise_reduction`, `vocal_start_s`, `vocal_end_s`).

The intentionally ignored static input keys are `prompt` and `api_key`. `prompt` is already lifted into the provider request as the main prompt field; `api_key` belongs in provider credential handling, not per-model request bodies.

## Remaining Practical Boundary

This is a broad, family-based MemeFast adapter copied from the Moyin capability model. It is not a guarantee that every advanced provider-specific parameter has perfect parity on day one.

The hard guarantee is narrower and operational:

- no static UI model is dropped from the adapter inventory;
- no model is silently routed to MuAPI;
- unsupported or disabled paths fail explicitly;
- `minimax-voice-clone` stays visible as an inventory record but execution is blocked until the MemeFast endpoint is verified;
- new model families can be added by registering family metadata, aliases, request plan, and audit coverage.
