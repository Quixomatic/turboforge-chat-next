import { NextRequest, NextResponse } from 'next/server';

const API_PROXY_URL = process.env.API_PROXY_URL || 'http://localhost:3000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ operationId: string }> }
) {
  try {
    const { operationId } = await params;

    const response = await fetch(`${API_PROXY_URL}/api/status/${operationId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`API Proxy error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Status proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to check operation status' },
      { status: 500 }
    );
  }
}