import { useQuery } from "@tanstack/react-query";
import { fetchAllMarkets, type AggregateMarket } from "@/lib/nexus/exchanges";
import { scanArbitrage, type ArbitrageOpportunity } from "@/lib/nexus/arbitrage";

export function useNexusMarkets(refetchMs = 3000) {
  return useQuery<AggregateMarket>({
    queryKey: ["nexus", "markets"],
    queryFn: fetchAllMarkets,
    refetchInterval: refetchMs,
    staleTime: refetchMs,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useNexusArbitrage(refetchMs = 5000): {
  opportunities: ArbitrageOpportunity[];
  isLoading: boolean;
  errors: AggregateMarket["errors"];
} {
  const { data, isLoading } = useNexusMarkets(refetchMs);
  const opportunities = data ? scanArbitrage(data) : [];
  return { opportunities, isLoading, errors: data?.errors ?? {} };
}
