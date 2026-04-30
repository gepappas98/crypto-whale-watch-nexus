import botRoutes from './bot.routes'

// After your existing whale routes
app.use('/api/bot', verifyJWT, botRoutes)
