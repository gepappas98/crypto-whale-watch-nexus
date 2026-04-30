import { useQuery } from '@tanstack/react-query'
import { useBotStore } from '@/store/botStore'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Download, TrendingUp, TrendingDown } from 'lucide-react'

const COLORS = ['#00d4ff', '#00ff88', '#ffaa00', '#ff3366']

export function Portfolio() {
  const { totalPnl, strategyPnl } = useBotStore()

  const { data: summary } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: () => fetch('/api/portfolio/summary').then(r => r.json()),
    refetchInterval: 5000
  })

  const { data: history } = useQuery({
    queryKey: ['trade-history'],
    queryFn: () => fetch('/api/portfolio/history?limit=100').then(r => r.json())
  })

  const { data: performance } = useQuery({
    queryKey: ['performance'],
    queryFn: () => fetch('/api/portfolio/performance').then(r => r.json())
  })

  const allocationData = Object.entries(strategyPnl).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value
  }))

  const exportCSV = async () => {
    const res = await fetch('/api/portfolio/history?format=csv')
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trades-${Date.now()}.csv`
    a.click()
  }

  return (
    <div className="p-6 bg-[#0a0a0f] min-h-screen">
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Total AUM</div>
          <div className="text-2xl text-white font-bold">
            ${summary?.total_aum?.toLocaleString() || '0'}
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Daily P&L</div>
          <div className={`text-2xl font-bold flex items-center gap-2 ${totalPnl >= 0? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
            {totalPnl >= 0? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            ${Math.abs(totalPnl).toFixed(2)}
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Win Rate</div>
          <div className="text-2xl text-[#00d4ff] font-bold">
            {summary?.win_rate?.toFixed(1) || '0'}%
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Total Trades</div>
          <div className="text-2xl text-white font-bold">
            {summary?.total_trades || 0}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        <Card className="bg-[#14141f] border-none p-6">
          <h3 className="text-white text-lg mb-4">Strategy Allocation</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={allocationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                {allocationData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #14141f' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 space-y-2">
            {allocationData.map((s, i) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-[#8b8b9e]">{s.name}</span>
                </div>
                <span className="text-white">${s.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-[#14141f] border-none p-6 col-span-2">
          <h3 className="text-white text-lg mb-4">Cumulative Returns</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={performance?.cumulative || []}>
              <XAxis dataKey="date" stroke="#8b8b9e" fontSize={12} />
              <YAxis stroke="#8b8b9e" fontSize={12} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #14141f' }} />
              <Line type="monotone" dataKey="pnl" stroke="#00ff88" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="benchmark" stroke="#8b8b9e" strokeWidth={1} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="bg-[#14141f] border-none p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-lg">Trade History</h3>
          <Button
            variant="outline"
            size="sm"
            className="border-[#8b8b9e] text-[#8b8b9e] hover:bg-[#0a0a0f]"
            onClick={exportCSV}
          >
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-[#0a0a0f]">
              <TableHead className="text-[#8b8b9e]">Time</TableHead>
              <TableHead className="text-[#8b8b9e]">Strategy</TableHead>
              <TableHead className="text-[#8b8b9e]">Pair</TableHead>
              <TableHead className="text-[#8b8b9e]">Side</TableHead>
              <TableHead className="text-[#8b8b9e]">Size</TableHead>
              <TableHead className="text-[#8b8b9e]">Price</TableHead>
              <TableHead className="text-[#8b8b9e]">P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history?.map((t: any) => (
              <TableRow key={t.id} className="border-[#0a0a0f]">
                <TableCell className="text-[#8b8b9e] text-xs">
                  {new Date(t.timestamp).toLocaleString()}
                </TableCell>
                <TableCell><Badge variant="outline">{t.strategy}</Badge></TableCell>
                <TableCell className="text-white">{t.pair}</TableCell>
                <TableCell className={t.side === 'buy'? 'text-[#00ff88]' : 'text-[#ff3366]'}>
                  {t.side.toUpperCase()}
                </TableCell>
                <TableCell className="text-white">{t.size}</TableCell>
                <TableCell className="text-white">${t.price}</TableCell>
                <TableCell className={t.pnl >= 0? 'text-[#00ff88]' : 'text-[#ff3366]'}>
                  ${t.pnl.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
