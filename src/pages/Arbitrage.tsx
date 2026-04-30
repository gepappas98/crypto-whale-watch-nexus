import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useBotStore } from '@/store/botStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { ArrowUpDown, Zap } from 'lucide-react'
import { toast } from 'sonner'

export function ArbitrageCommandCenter() {
  const queryClient = useQueryClient()
  const { arbitrageOpps, setArbitrageOpps } = useBotStore()

  const { data: opps } = useQuery({
    queryKey: ['arbitrage-opps'],
    queryFn: async () => {
      const res = await fetch('/api/bot/arbitrage/opportunities')
      const data = await res.json()
      setArbitrageOpps(data)
      return data
    },
    refetchInterval: 2000
  })

  const executeMutation = useMutation({
    mutationFn: (id: string) =>
      fetch('/api/bot/arbitrage/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: id })
      }),
    onSuccess: () => {
      toast.success('Arbitrage execution started', {
        style: { background: '#14141f', border: '1px solid #00d4ff' }
      })
      queryClient.invalidateQueries({ queryKey: ['arbitrage-opps'] })
    }
  })

  const getConfidenceColor = (c: string) => ({
    high: 'bg-[#00ff88]/20 text-[#00ff88]',
    medium: 'bg-[#ffaa00]/20 text-[#ffaa00]',
    low: 'bg-[#8b8b9e]/20 text-[#8b8b9e]'
  }[c])

  return (
    <div className="p-6 bg-[#0a0a0f] min-h-screen">
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Active Opportunities</div>
          <div className="text-2xl text-white font-bold">{arbitrageOpps.filter(o => o.status === 'detected').length}</div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Avg Spread</div>
          <div className="text-2xl text-[#00d4ff] font-bold">
            {(arbitrageOpps.reduce((a, b) => a + b.spreadPercent, 0) / arbitrageOpps.length || 0).toFixed(3)}%
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Est. Profit Today</div>
          <div className="text-2xl text-[#00ff88] font-bold">
            ${arbitrageOpps.reduce((a, b) => a + b.estimatedProfit, 0).toFixed(2)}
          </div>
        </Card>
      </div>

      <Card className="bg-[#14141f] border-none">
        <Table>
          <TableHeader>
            <TableRow className="border-[#0a0a0f] hover:bg-[#14141f]">
              <TableHead className="text-[#8b8b9e]">Pair</TableHead>
              <TableHead className="text-[#8b8b9e]">Route</TableHead>
              <TableHead className="text-[#8b8b9e]">Spread</TableHead>
              <TableHead className="text-[#8b8b9e]">Funding Diff</TableHead>
              <TableHead className="text-[#8b8b9e]">Confidence</TableHead>
              <TableHead className="text-[#8b8b9e]">Est. Profit</TableHead>
              <TableHead className="text-[#8b8b9e]">Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {arbitrageOpps.map(opp => (
              <TableRow key={opp.id} className="border-[#0a0a0f] hover:bg-[#0a0a0f]/50">
                <TableCell className="text-white font-medium">{opp.pair}</TableCell>
                <TableCell className="text-[#8b8b9e]">
                  {opp.exchanges[0]} <ArrowUpDown className="inline w-3 h-3" /> {opp.exchanges[1]}
                </TableCell>
                <TableCell>
                  <span className={opp.spreadPercent > opp.historicalBaseline? 'text-[#00ff88]' : 'text-[#ffaa00]'}>
                    {opp.spreadPercent.toFixed(3)}%
                  </span>
                </TableCell>
                <TableCell className="text-[#8b8b9e]">{(opp.fundingRateDiff * 100).toFixed(4)}%</TableCell>
                <TableCell>
                  <Badge className={getConfidenceColor(opp.confidence)}>{opp.confidence}</Badge>
                </TableCell>
                <TableCell className="text-[#00ff88]">${opp.estimatedProfit.toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={opp.status === 'filled'? 'success' : 'default'}>{opp.status}</Badge>
                </TableCell>
                <TableCell>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" className="bg-[#00d4ff] hover:bg-[#00b8e6] text-black">
                        <Zap className="w-3 h-3 mr-1" /> Execute
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-[#14141f] border-[#0a0a0f]">
                      <DialogHeader className="text-white">Confirm Arbitrage Execution</DialogHeader>
                      <div className="space-y-4 text-[#8b8b9e]">
                        <div>Pair: <span className="text-white">{opp.pair}</span></div>
                        <div>Est. Profit: <span className="text-[#00ff88]">${opp.estimatedProfit}</span></div>
                        <div>Spread: <span className="text-white">{opp.spreadPercent}%</span></div>
                        <ResponsiveContainer width="100%" height={100}>
                          <LineChart data={[{v: opp.historicalBaseline}, {v: opp.spreadPercent}]}>
                            <Line type="monotone" dataKey="v" stroke="#00d4ff" dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                        <Button
                          className="w-full bg-[#ff3366] hover:bg-[#e62e5c]"
                          onClick={() => executeMutation.mutate(opp.id)}
                          disabled={executeMutation.isPending}
                        >
                          Confirm & Execute
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
