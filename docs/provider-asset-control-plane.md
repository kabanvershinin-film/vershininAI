# Provider Asset Control Plane

This project routes generation through a provider adapter layer. Provider switching, asset upload, and result archiving must stay server-controlled.

## Runtime Config

Server config is loaded from:

- `GENAI_PROVIDER_CONFIG_JSON`, if set.
- `GENAI_PROVIDER_CONFIG_PATH`, if set.
- `.genai/provider-config.json`, by default.

Task and asset state use:

- `GENAI_TASK_STORE_PATH`, or `.genai/tasks.json`.
- `GENAI_ASSET_STORE_PATH`, or `.genai/assets.json`.

`.genai/` is ignored because it can contain runtime routing state and asset references.

## Control Endpoints

- `GET /api/providers` returns adapters plus the server provider config snapshot.
- `PATCH /api/providers` updates the server provider config.
- `POST /api/providers/test` verifies provider credentials.
- `POST /api/providers/sync-models` syncs model inventory without deleting stale models.
- `POST /api/assets/upload-intent` creates a provider-aware upload intent.
- `POST /api/assets/external-url` registers an already-hosted asset URL after SSRF-safe validation.

## Hard Rules

- Normal text, image, video, and audio generation uses the selected server provider unless an explicit MuAPI-only feature override exists.
- Disabled providers, disabled models, and disabled route families fail explicitly.
- Upload for a non-MuAPI provider goes through `/api/assets/upload-intent`; it must not call MuAPI upload as a hidden fallback.
- External and provider result URLs must be HTTPS public URLs. Private IPs, localhost, credentials in URLs, and non-HTTPS protocols are rejected.
- Provider result URLs are not treated as stable long-term URLs unless archiving succeeds.

## Storage Modes

Current implemented modes:

- `disabled`: upload intent fails; provider result URLs are validated and recorded as `pending_storage`, not stable assets.
- `local_public`: development-only local public storage under `public/generated-assets` with a configured `publicBaseUrl`.

Production storage should add a dedicated storage adapter for R2, S3, OSS, or COS. Do not replace this with a random image host.
