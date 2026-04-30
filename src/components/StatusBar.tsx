import { useBotStore } from '@/store/botStore'
import { Wifi, WifiOff, Activity } from 'lucide-react'

export function StatusBar() {
  const { wsConnected, totalPnl, activeStrategies } = useBotStore()

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 bg-[#14141f] border-t border-[#0a0a0f] flex items-center justify-between px-4 text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          {wsConnected? <Wifi className="w-3 h-3 text-[#00ff88]" /> : <WifiOff className="w-3 h-3 text-[#ff3366]" />}
          <span className="text-[#8b8b9e]">Bot: {wsConnected? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-[#00d4ff]" />
          <span className="text-[#8b8b9e]">Strategies: <span className="text-white">{activeStrategies}</span></span>
        </div>
      </div>
      <div className={totalPnl >= 0? 'text-[#00ff88]' : 'text-[#ff3366]'}>
        Total P&L: ${totalPnl.toFixed(2)}
      </div>
    </div>
  )
}
