require('dotenv').config()
const express    = require('express')
const cors       = require('cors')
const errorHandler = require('./middleware/errorHandler')

const app = express()

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'))
app.use('/api/group',         require('./routes/group'))
app.use('/api/members',       require('./routes/members'))
app.use('/api/contributions', require('./routes/contributions'))
app.use('/api/loans',         require('./routes/loans'))
app.use('/api/reports',       require('./routes/reports'))

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }))

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use(errorHandler)

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`🚀  Re-Mmogo API running on http://localhost:${PORT}`))
