import { ProviderLayerError } from '../errors.js';

const PRIVATE_IPV4_RANGES = Object.freeze([
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['0.0.0.0', 8],
]);

function ipv4ToNumber(value) {
    const parts = String(value).split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
        if (!/^\d+$/.test(part)) return null;
        const number = Number(part);
        if (number < 0 || number > 255) return null;
        out = (out << 8) + number;
    }
    return out >>> 0;
}

function isPrivateIpv4(hostname) {
    const ip = ipv4ToNumber(hostname);
    if (ip === null) return false;
    return PRIVATE_IPV4_RANGES.some(([base, mask]) => {
        const baseNumber = ipv4ToNumber(base);
        const maskNumber = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
        return (ip & maskNumber) === (baseNumber & maskNumber);
    });
}

function isBlockedHostname(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    if (!normalized) return true;
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
    if (normalized === '::1' || normalized === '[::1]') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80:')) return true;
    return isPrivateIpv4(normalized);
}

export function assertSafeExternalAssetUrl(url, details = {}) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new ProviderLayerError('asset_url_rejected', 'Asset URL is not a valid URL', { url, ...details });
    }
    if (parsed.protocol !== 'https:') {
        throw new ProviderLayerError('asset_url_rejected', 'Asset URL must use HTTPS', { url, protocol: parsed.protocol, ...details });
    }
    if (parsed.username || parsed.password) {
        throw new ProviderLayerError('asset_url_rejected', 'Asset URL must not include credentials', { url, ...details });
    }
    if (isBlockedHostname(parsed.hostname)) {
        throw new ProviderLayerError('asset_url_rejected', 'Asset URL host is not allowed', { url, hostname: parsed.hostname, ...details });
    }
    return parsed.toString();
}
