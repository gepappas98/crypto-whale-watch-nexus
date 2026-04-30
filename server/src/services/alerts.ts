export async function runCorrelationCheck() {
  // 1. Get whales from your existing table
  const { data: whales } = await supabase
    .from('whale_transactions')
    .select('*')
    .gte('created_at', new Date(Date.now() - 60000).toISOString())

  // 2. Get live arb opps from bot
  const opps = await axios.get(`${BOT_BRIDGE}/arbitrage/opportunities`)

  // 3. Match on pair + time window
  for (const w of whales) {
    const match = opps.data.find(o => 
      o.pair === w.pair && o.spreadPercent > 0.3
    )
    if (match) {
      await supabase.from('alerts').insert({
        type: 'whale_bot_correlation',
        severity: 'high',
        whale_tx_id: w.id,
        arb_id: match.id
      })
      // Trigger WebSocket push to frontend
      io.emit('alert', { type: 'whale_bot_correlation', data: { whale: w, arb: match }})
    }
  }
}
setInterval(runCorrelationCheck, 5000) // 5s real correlation
