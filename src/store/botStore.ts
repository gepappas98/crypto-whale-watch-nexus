import { create } from 'zustand'
import { toast } from 'sonner'

interface ArbitrageOpportunity {
  id: string
  pair: string
  exchanges: [string, string]
  spreadPercent: number
  fundingRateDiff: number
  historicalBaseline: number
  confidence: "high" | "medium" | "low"
  direction: "long_short" | "short_long"
  estimatedProfit: number
  status: "detected" | "executing" | "filled" | "failed"
  timestamp: Date
}

interface GridLog {
  timestamp: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE'
  message: string
}

interface BotState {
  wsConnected: boolean
  arbitrageOpps: ArbitrageOpportunity[]
  gridLogs: Record<string, GridLog[]>
  totalPnl: number
  strategyPnl: Record<string, number>
  activeStrategies: number
  alerts: any[]

  setWsConnected: (connected: boolean) => void
  updateArbitrage: (update: Partial<ArbitrageOpportunity> & { id: string }) => void
  setArbitrageOpps: (opps: ArbitrageOpportunity[]) => void
  appendGridLog: (gridId: string, log: GridLog) => void
  updatePnl: (data: { total: number, strategies: Record<string, number> }) => void
  addAlert: (alert: any) => void
}

export const useBotStore = create<BotState>((set) => ({
  wsConnected: false,
  arbitrageOpps: [],
  gridLogs: {},
  totalPnl: 0,
  strategyPnl: {},
  activeStrategies: 0,
  alerts: [],

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setArbitrageOpps: (opps) => set({ arbitrageOpps: opps }),

  updateArbitrage: (update) => set((state) => ({
    arbitrageOpps: state.arbitrageOpps.map(o =>
      o.id === update.id? {...o,...update } : o
    )
  })),

  appendGridLog: (gridId, log) => set((state) => ({
    gridLogs: {
     ...state.gridLogs,
      [gridId]: [...(state.gridLogs[gridId] || []), log].slice(-500) // keep last 500
    }
  })),

  updatePnl: (data) => set({
    totalPnl: data.total,
    strategyPnl: data.strategies,
    activeStrategies: Object.keys(data.strategies).length
  }),

  addAlert: (alert) => {
    set((state) => ({ alerts: [alert,...state.alerts].slice(0, 50) }))
    if (alert.severity === 'high') {
      toast.error(alert.message, {
        style: { background: '#14141f', border: '1px solid #ff3366', color: '#fff' }
      })
    }
  }
}))
