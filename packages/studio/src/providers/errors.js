export class ProviderLayerError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ProviderLayerError';
        this.code = code;
        this.details = details;
    }
}

export function normalizeProviderError(error, defaultCode = 'provider_error') {
    if (error instanceof ProviderLayerError) {
        return {
            code: error.code,
            message: error.message,
            details: error.details || {},
        };
    }
    const status = typeof error?.status === 'number' ? error.status : undefined;
    const transient = Boolean(error?.transient) || [408, 429, 500, 502, 503, 504, 529].includes(status);
    return {
        code: defaultCode,
        message: error instanceof Error ? error.message : String(error),
        details: {
            ...(status ? { status } : {}),
            ...(transient ? { transient: true } : {}),
            ...(error?.phase ? { phase: error.phase } : {}),
            ...(error?.timeoutMs ? { timeoutMs: error.timeoutMs } : {}),
        },
    };
}

export function maskSecret(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.length <= 8) return '***';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
