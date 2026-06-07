import { NextResponse } from 'next/server';

export async function POST(request) {
    const body = await request.json();
    const providerId = body.providerId || 'muapi';
    const baseUrl = (body.baseUrl || (providerId === 'memefast' ? 'https://memefast.top' : 'https://api.muapi.ai')).replace(/\/+$/, '');
    const apiKey = body.apiKey || request.headers.get('x-api-key') || '';
    const url = providerId === 'memefast' ? `${baseUrl}/v1/models` : `${baseUrl}/api/v1/account/balance`;
    const headers = providerId === 'memefast'
        ? { Authorization: `Bearer ${apiKey}` }
        : { 'x-api-key': apiKey };
    try {
        const response = await fetch(url, { headers });
        return NextResponse.json({
            success: response.ok,
            data: {
                providerId,
                status: response.status,
            },
        }, { status: response.ok ? 200 : 400 });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: {
                code: 'provider_test_failed',
                message: error instanceof Error ? error.message : String(error),
            },
        }, { status: 400 });
    }
}
