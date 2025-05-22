import { NextRequest, NextResponse } from 'next/server';

const API_PROXY_URL = process.env.API_PROXY_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_PROXY_URL}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API Proxy error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Research proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate research' },
      { status: 500 }
    );
  }
}