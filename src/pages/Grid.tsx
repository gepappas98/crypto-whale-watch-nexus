import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBotStore } from '@/store/botStore'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

function GridTerminal({ gridId }: { gridId: string }) {
  const termRef = useRef<HTMLDivElement>(null)
  const { gridLogs } = useBotStore()

  useEffect(() => {
    if (!termRef.current) return
    const term = new Terminal({
      theme: { background: '#0a0a0f', foreground: '#ffffff', cursor: '#00d4ff' },
      fontSize: 12,
      fontFamily: 'JetBrains Mono, monospace'
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()

    // Stream real logs from Zustand
    const logs = gridLogs[gridId] || []
    logs.forEach(log => {
      const color = log.level === 'ERROR'? '\x1b[31m' : log.level === 'TRADE'? '\x1b[32m' : '\x1b[37m'
      term.writeln(`${color}[${log.timestamp}] ${log.level}: ${log.message}\x1b[0m`)
    })

    return () => term.dispose()
  }, [gridId, gridLogs])

  return <div ref={termRef} className="h-96 bg-[#0a0a0f] rounded" />
}

export function GridStudio() {
  const [config, setConfig] = useState({
    exchange: 'hyperliquid',
    symbol: 'BTC/USDC',
    marketType: 'perpetual',
    mode: 'normal',
    upperPrice: 70000,
    lowerPrice: 60000,
    gridCount: 50,
    totalInvestment: 10000,
    feeRate: 0.001
  })

  const deployMutation = useMutation({
    mutationFn: (cfg: any) =>
      fetch('/api/bot/grid/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      }).then(r => r.json())
  })

  const { data: activeGrids } = useQuery({
    queryKey: ['grids'],
    queryFn: () => fetch('/api/bot/grid/list').then(r => r.json()),
    refetchInterval: 5000
  })

  return (
    <div className="p-6 bg-[#0a0a0f] min-h-screen grid grid-cols-2 gap-6">
      <Card className="bg-[#14141f] border-none p-6">
        <h2 className="text-white text-xl mb-4">Grid Builder</h2>
        <div className="space-y-4">
          <Select value={config.exchange} onValueChange={v => setConfig({...config, exchange: v})}>
            <SelectTrigger className="bg-[#0a0a0f] border-[#8b8b9e] text-white">
              {config.exchange}
            </SelectTrigger>
            <SelectContent className="bg-[#14141f]">
              <SelectItem value="hyperliquid">Hyperliquid</SelectItem>
              <SelectItem value="backpack">Backpack</SelectItem>
              <SelectItem value="binance">Binance</SelectItem>
            </SelectContent>
          </Select>

          <Input
            value={config.symbol}
            onChange={e => setConfig({...config, symbol: e.target.value})}
            className="bg-[#0a0a0f] border-[#8b8b9e] text-white"
          />

          <div>
            <label className="text-[#8b8b9e] text-sm">Price Range</label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={config.lowerPrice}
                onChange={e => setConfig({...config, lowerPrice: +e.target.value})}
                className="bg-[#0a0a0f] border-[#8b8b9e] text-white"
              />
              <Input
                type="number"
                value={config.upperPrice}
                onChange={e => setConfig({...config, upperPrice: +e.target.value})}
                className="bg-[#0a0a0f] border-[#8b8b9e] text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-[#8b8b9e] text-sm">Grid Count: {config.gridCount}</label>
            <Slider
              value={[config.gridCount]}
              onValueChange={([v]) => setConfig({...config, gridCount: v})}
              min={10} max={200} step={10}
              className="[&>span]:bg-[#00d4ff]"
            />
          </div>

          <Input
            type="number"
            value={config.totalInvestment}
            onChange={e => setConfig({...config, totalInvestment: +e.target.value})}
            className="bg-[#0a0a0f] border-[#8b8b9e] text-white"
            placeholder="Total Investment"
          />

          <Button
            className="w-full bg-[#00d4ff] hover:bg-[#00b8e6] text-black"
            onClick={() => deployMutation.mutate(config)}
          >
            Deploy Grid in 3 Clicks
          </Button>
        </div>
      </Card>

      <Card className="bg-[#14141f] border-none p-6">
        <h2 className="text-white text-xl mb-4">Live Grid Terminal</h2>
        {activeGrids?.[0]? (
          <GridTerminal gridId={activeGrids[0].id} />
        ) : (
          <div className="text-[#8b8b9e] text-center py-20">Deploy a grid to see logs</div>
        )}
      </Card>
    </div>
  )
}
