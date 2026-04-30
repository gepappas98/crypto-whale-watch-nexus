import { Router } from 'express'
import axios from 'axios'
const router = Router()
const BOT_BRIDGE = process.env.BOT_BRIDGE_URL || 'http://localhost:8000'

router.get('/volume/stats', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/volume/stats`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.get('/volume/status', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/volume/status`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.post('/volume/start', async (req, res) => {
  const { data } = await axios.post(`${BOT_BRIDGE}/volume/start`, req.body, {
    headers: { Authorization: req.headers.authorization }
  })
  await supabase.from('bot_executions').insert({
    user_id: req.user.id,
    type: 'volume',
    config: req.body
  })
  res.json(data)
})

router.post('/volume/stop', async (req, res) => {
  const { data } = await axios.post(`${BOT_BRIDGE}/volume/stop`, {}, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.get('/portfolio/summary', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/portfolio/summary`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.get('/portfolio/history', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/portfolio/history`, {
    params: req.query,
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.get('/portfolio/performance', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/portfolio/performance`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

router.get('/arbitrage/opportunities', async (req, res) => {
  const { data } = await axios.get(`${BOT_BRIDGE}/arbitrage/opportunities`, {
    headers: { Authorization: req.headers.authorization }
  })
  res.json(data)
})

// Add POST /arbitrage/execute, /grid/create, /volume/start, etc
// Use your existing Supabase client to log executions to `bot_executions` table

export default router
