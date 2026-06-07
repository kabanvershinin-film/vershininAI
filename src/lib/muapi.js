import {
    generateAudio,
    generateI2I,
    generateI2V,
    generateImage,
    generateVideo,
    processLipSync,
    processV2V,
    uploadFile,
} from '../../packages/studio/src/muapi.js';
import { getProviderApiKey, loadProviderConfig } from '../../packages/studio/src/providers/config.js';

function selectedProviderId() {
    return loadProviderConfig().selectedProviderId || 'memefast';
}

function currentApiKey() {
    const providerId = selectedProviderId();
    const providerKey = getProviderApiKey(providerId);
    if (providerKey) return providerKey;
    if (providerId === 'muapi') return window.__MUAPI_KEY__ || localStorage.getItem('muapi_key') || '';
    return '';
}

function requireKey() {
    const key = currentApiKey();
    if (!key) {
        throw new Error(`API key missing for provider ${selectedProviderId()}. Please set it in Settings.`);
    }
    return key;
}

export class MuapiClient {
    getKey() {
        return requireKey();
    }

    async generateImage(params) {
        return generateImage(requireKey(), params);
    }

    async generateVideo(params) {
        return generateVideo(requireKey(), params);
    }

    async generateI2I(params) {
        return generateI2I(requireKey(), params);
    }

    async generateI2V(params) {
        return generateI2V(requireKey(), params);
    }

    async uploadFile(file, onProgress) {
        return uploadFile(requireKey(), file, onProgress);
    }

    async processV2V(params) {
        return processV2V(requireKey(), params);
    }

    async processLipSync(params) {
        return processLipSync(requireKey(), params);
    }

    async generateAudio(params) {
        return generateAudio(requireKey(), params);
    }

    getDimensionsFromAR(ar) {
        switch (ar) {
            case '1:1': return [1024, 1024];
            case '16:9': return [1280, 720];
            case '9:16': return [720, 1280];
            case '4:3': return [1152, 864];
            case '3:2': return [1216, 832];
            case '21:9': return [1536, 640];
            default: return [1024, 1024];
        }
    }
}

export const muapi = new MuapiClient();
