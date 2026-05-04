import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Coinbase Spot Price API (Simple, No Auth)
 * Endpoint: GET /api/proxy/coinbase?symbol=BTC-USD
 * Returns: { "data": { "base": "BTC", "currency": "USD", "amount": "65234.50" } }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "BTC-USD";

  try {
    // Use the SIMPLE spot price API — no auth, no CORS issues
    const res = await fetch(
      `https://api.coinbase.com/v2/prices/${symbol}/spot`,
      {
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      return NextResponse.json(
        { error: `Coinbase HTTP ${res.status}: ${body}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 }
    );
  }
}
