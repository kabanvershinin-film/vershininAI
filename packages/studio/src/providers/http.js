export function normalizeProviderBaseUrl(baseUrl, defaultBaseUrl = '') {
    return (baseUrl || defaultBaseUrl || '').replace(/\/+$/, '');
}

export async function readJsonResponse(response, label = 'Provider request') {
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    if (!response.ok) {
        const message = typeof data === 'object' && data
            ? (data.error?.message || data.message || data.detail || JSON.stringify(data).slice(0, 300))
            : String(data || response.statusText);
        const error = new Error(`${label} failed: ${response.status} ${message}`);
        error.status = response.status;
        error.raw = data;
        throw error;
    }
    return data;
}

export function createBrowserFetch() {
    return (input, init) => fetch(input, init);
}
