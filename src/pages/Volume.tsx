import { useMutation, useQuery } from '@tanstack/react-query'
import { useBotStore } from '@/store/botStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Play, Square, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

export function VolumeController() {
  const { wsConnected } = useBotStore()

  const { data: stats } = useQuery({
    queryKey: ['volume-stats'],
    queryFn: () => fetch('/api/bot/volume/stats').then(r => r.json()),
    refetchInterval: 3000
  })

  const { data: status } = useQuery({
    queryKey: ['volume-status'],
    queryFn: () => fetch('/api/bot/volume/status').then(r => r.json()),
    refetchInterval: 2000
  })

  const startMutation = useMutation({
    mutationFn: (config: any) =>
      fetch('/api/bot/volume/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      }),
    onSuccess: () => toast.success('Volume maker started', {
      style: { background: '#14141f', border: '1px solid #00ff88' }
    })
  })

  const stopMutation = useMutation({
    mutationFn: () => fetch('/api/bot/volume/stop', { method: 'POST' }),
    onSuccess: () => toast.info('Volume maker stopped')
  })

  const toggleSafety = useMutation({
    mutationFn: (enabled: boolean) =>
      fetch('/api/bot/volume/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_pause_on_whale: enabled })
      })
  })

  return (
    <div className="p-6 bg-[#0a0a0f] min-h-screen">
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">24h Volume</div>
          <div className="text-2xl text-white font-bold">
            ${stats?.volume_24h?.toLocaleString() || '0'}
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Total Fees Paid</div>
          <div className="text-2xl text-[#ff3366] font-bold">
            ${stats?.fees_24h?.toFixed(2) || '0.00'}
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Rebates Earned</div>
          <div className="text-2xl text-[#00ff88] font-bold">
            ${stats?.rebates_24h?.toFixed(2) || '0.00'}
          </div>
        </Card>
        <Card className="bg-[#14141f] border-none p-4">
          <div className="text-[#8b8b9e] text-sm">Net P&L</div>
          <div className={`text-2xl font-bold ${(stats?.rebates_24h - stats?.fees_24h) >= 0? 'text-[#00ff88]' : 'text-[#ff3366]'}`}>
            ${((stats?.rebates_24h || 0) - (stats?.fees_24h || 0)).toFixed(2)}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="bg-[#14141f] border-none p-6">
          <h3 className="text-white text-lg mb-4">Control Panel</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[#8b8b9e] text-sm">Exchange</label>
              <Select defaultValue="backpack">
                <SelectTrigger className="bg-[#0a0a0f] border-[#8b8b9e] text-white">
                  Backpack
                </SelectTrigger>
                <SelectContent className="bg-[#14141f]">
                  <SelectItem value="backpack">Backpack Limit</SelectItem>
                  <SelectItem value="lighter">Lighter Market</SelectItem>
                  <SelectItem value="hyperliquid">Hyperliquid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[#8b8b9e] text-sm">Signal Source</label>
              <Select defaultValue="hyperliquid_ws">
                <SelectTrigger className="bg-[#0a0a0f] border-[#8b8b9e] text-white">
                  Hyperliquid WebSocket
                </SelectTrigger>
                <SelectContent className="bg-[#14141f]">
                  <SelectItem value="hyperliquid_ws">Hyperliquid WS</SelectItem>
                  <SelectItem value="backpack_rest">Backpack REST</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-white text-sm">Auto-Pause on Whale</div>
                <div className="text-[#8b8b9e] text-xs">Stops if whale tx {'>'} $1M detected</div>
              </div>
              <Switch
                checked={status?.auto_pause_enabled}
                onCheckedChange={(v) => toggleSafety.mutate(v)}
              />
            </div>

            <div className="pt-4 border-t border-[#0a0a0f]">
              {status?.running? (
                <Button
                  className="w-full bg-[#ff3366] hover:bg-[#e62e5c]"
                  onClick={() => stopMutation.mutate()}
                >
                  <Square className="w-4 h-4 mr-2" /> Stop Volume Maker
                </Button>
              ) : (
                <Button
                  className="w-full bg-[#00ff88] hover:bg-[#00e67a] text-black"
                  onClick={() => startMutation.mutate({ exchange: 'backpack', signal: 'hyperliquid_ws' })}
                  disabled={!wsConnected}
                >
                  <Play className="w-4 h-4 mr-2" /> Start Volume Maker
                </Button>
              )}
              {!wsConnected && (
                <div className="text-[#ffaa00] text-xs mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Bot bridge disconnected
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="bg-[#14141f] border-none p-6 col-span-2">
          <h3 className="text-white text-lg mb-4">Hourly Volume</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats?.hourly_volume || []}>
              <XAxis dataKey="hour" stroke="#8b8b9e" fontSize={12} />
              <YAxis stroke="#8b8b9e" fontSize={12} />
              <Tooltip
                contentStyle={{ background: '#0a0a0f', border: '1px solid #14141f' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="volume" fill="#00d4ff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="bg-[#14141f] border-none p-6 mt-6">
        <h3 className="text-white text-lg mb-4">Active Status</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-[#8b8b9e]">Status: </span>
            <Badge variant={status?.running? 'success' : 'default'}>
              {status?.running? 'Running' : 'Stopped'}
            </Badge>
          </div>
          <div>
            <span className="text-[#8b8b9e]">Active Pair: </span>
            <span className="text-white">{status?.pair || 'None'}</span>
          </div>
          <div>
            <span className="text-[#8b8b9e]">Orders/min: </span>
            <span className="text-[#00d4ff]">{status?.orders_per_min || 0}</span>
          </div>
        </div>
      </Card>
    </div>
  )
}
