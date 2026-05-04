import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * CryptoCompare API Proxy
 * Aggregates prices from 200+ exchanges including Binance, Coinbase, Kraken
 * Endpoint: GET /api/proxy/cryptocompare?fsym=BTC&tsyms=USD
 * Free tier: 100k calls/month, no auth required
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fsym = searchParams.get("fsym") || "BTC";
  const tsyms = searchParams.get("tsyms") || "USD";

  try {
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/price?fsym=${fsym}&tsyms=${tsyms}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      return NextResponse.json(
        { error: `CryptoCompare HTTP ${res.status}: ${body}` },
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
