import { useAllMids } from '@/hooks/useHyperliquid';

export default function HLTable() {
  const { data, loading, error } = useAllMids();

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.symbol}>
            <td>{row.symbol}</td>
            <td>{row.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
