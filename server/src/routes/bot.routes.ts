import { Router } from 'express'
import axios from 'axios'
const router = Router()
const BOT_BRIDGE = process.env.BOT_BRIDGE_URL || 'http://localhost:8000'

router.get('/arbitrage/opportunities', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/arbitrage/opportunities`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

// Add POST /arbitrage/execute, /grid/create, /volume/start, etc
// Use your existing Supabase client to log executions to `bot_executions` table

export default router
