const ASSET_STORAGE_KEY = 'genai_assets_v1';

function canUseLocalStorage() {
    return typeof window !== 'undefined' && window.localStorage;
}

function canUseServerFileStore() {
    return typeof process !== 'undefined' && process.versions?.node && typeof process.getBuiltinModule === 'function';
}

function serverStorePath() {
    if (!canUseServerFileStore()) return null;
    return process.env.GENAI_ASSET_STORE_PATH || '/tmp/.genai/assets.json';
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function memoryStore() {
    if (!globalThis.__GENAI_ASSET_STORE__) {
        globalThis.__GENAI_ASSET_STORE__ = {};
    }
    return globalThis.__GENAI_ASSET_STORE__;
}

function readServerAssets() {
    const filePath = serverStorePath();
    if (!filePath) return null;
    const fs = process.getBuiltinModule('fs');
    if (!fs.existsSync(filePath)) return {};
    return safeJsonParse(fs.readFileSync(filePath, 'utf8')) || {};
}

function writeServerAssets(assets) {
    const filePath = serverStorePath();
    if (!filePath) return false;
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(assets, null, 2)}\n`, 'utf8');
    return true;
}

export function loadAssets() {
    if (canUseLocalStorage()) {
        return safeJsonParse(localStorage.getItem(ASSET_STORAGE_KEY)) || {};
    }
    const serverAssets = readServerAssets();
    if (serverAssets) return serverAssets;
    return memoryStore();
}

export function saveAssets(assets) {
    if (canUseLocalStorage()) {
        localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(assets));
    } else if (writeServerAssets(assets)) {
        return assets;
    } else {
        globalThis.__GENAI_ASSET_STORE__ = assets;
    }
    return assets;
}

export function createAssetId(providerId, mediaType) {
    return `asset_${providerId || 'unknown'}_${mediaType || 'unknown'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function upsertAsset(record) {
    const assets = loadAssets();
    assets[record.assetId] = {
        ...(assets[record.assetId] || {}),
        ...record,
        updatedAt: new Date().toISOString(),
    };
    saveAssets(assets);
    return assets[record.assetId];
}

export function getAsset(assetId) {
    return loadAssets()[assetId] || null;
}
