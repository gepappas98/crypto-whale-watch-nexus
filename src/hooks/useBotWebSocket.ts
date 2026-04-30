import { useEffect, useRef } from 'react'
import { useBotStore } from '@/store/botStore'
import { supabase } from '@/lib/supabase'

export function useBotWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const { setWsConnected, updateArbitrage, appendGridLog, updatePnl, addAlert } = useBotStore()
  const reconnectTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const wsUrl = `${import.meta.env.VITE_BOT_WS_URL}/ws/live?token=${session.access_token}`
      ws.current = new WebSocket(wsUrl)

      ws.current.onopen = () => {
        setWsConnected(true)
        console.log('Bot WS connected')
      }

      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        switch(msg.type) {
          case 'ARBITRAGE_UPDATE':
            updateArbitrage(msg.data)
            if (msg.data.status === 'filled') {
              new Audio('/sounds/cash.mp3').play().catch(() => {})
            }
            break
          case 'GRID_LOG':
            appendGridLog(msg.grid_id, msg.data)
            break
          case 'PNL_UPDATE':
            updatePnl(msg.data) // <1s latency
            break
          case 'ALERT':
            addAlert(msg.data)
            if (msg.data.type === 'whale_bot_correlation') {
              new Audio('/sounds/alert.mp3').play().catch(() => {})
            }
            break
        }
      }

      ws.current.onclose = () => {
        setWsConnected(false)
        reconnectTimeout.current = setTimeout(connect, 3000)
      }

      ws.current.onerror = () => ws.current?.close()
    }

    connect()
    return () => {
      clearTimeout(reconnectTimeout.current)
      ws.current?.close()
    }
  }, [])
}
