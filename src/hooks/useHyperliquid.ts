import { useEffect, useState } from 'react';
import { hlFetch } from '@/lib/hyperliquid';

export function useAllMids() {
  const [data, setData] = useState<{ symbol: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await hlFetch<any>('allMids');
        setData(res.data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return { data, loading, error };
}
