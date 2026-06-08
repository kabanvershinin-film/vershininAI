import { NextResponse } from 'next/server';

const MUAPI_BASE = 'https://api.muapi.ai';

function getServerApiKey() {
    return process.env.MUAPI_API_KEY
        || process.env.GENAI_MUAPI_API_KEY
        || process.env.MUAPI_KEY
        || process.env.MUAPIAPP_API_KEY
        || '';
}

function getApiKey(request) {
    // Priority 1: Direct x-api-key header
    const headerKey = request.headers.get('x-api-key');
    if (headerKey) return headerKey;

    // Priority 2: muapi_key cookie (used by the fixed builder library)
    const cookieKey = request.cookies.get('muapi_key')?.value;
    if (cookieKey) return cookieKey;

    // Priority 3: server-side fallback key
    return getServerApiKey();
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie'); // CRITICAL: Stop forwarding browser cookies to MuAPI to avoid auth conflicts
    return headers;
}

export async function GET(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = getApiKey(request);
    console.log(`[proxy GET] ${targetUrl} | hasApiKey: ${Boolean(apiKey)}`);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            headers,
            method: 'GET',
        });
        const data = await response.json();
        if (path.includes('get-workflow-def')) {
            console.log(`[proxy GET] get-workflow-def response: is_owner=${data?.is_owner}, workflow_id=${data?.workflow_id}`);
        }
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = getApiKey(request);
    console.log(`[proxy POST] ${targetUrl} | hasApiKey: ${Boolean(apiKey)} | hasCookieKey: ${Boolean(request.cookies.get('muapi_key')?.value)} | hasHeaderKey: ${Boolean(request.headers.get('x-api-key'))}`);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        // Decode body to see what workflow_id is being sent
        try {
            const parsed = JSON.parse(Buffer.from(body).toString('utf-8'));
            console.log(`[proxy POST] body: workflow_id=${parsed.workflow_id}, source_workflow_id=${parsed.source_workflow_id}, name=${parsed.name}`);
        } catch(e) { /* ignore decode errors */ }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body
        });
        const data = await response.json();
        console.log(`[proxy POST] response: status=${response.status}`, JSON.stringify(data).slice(0, 200));
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            method: 'DELETE',
            headers
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        const response = await fetch(targetUrl, {
            method: 'PUT',
            headers,
            body
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
