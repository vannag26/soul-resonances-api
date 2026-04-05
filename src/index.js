import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import stripeRouter from './routes/stripe.js';
import contentRouter from './routes/content.js';
import authRouter from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Raw body needed for Stripe webhook signature verification
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Parse JSON for all other routes
app.use(express.json());

// CORS — allow soulresonances.com + Vercel preview URLs
app.use(cors({
  origin: [
    'https://soulresonances.com',
    'https://www.soulresonances.com',
    /^https:\/\/.*\.vercel\.app$/,
    'http://localhost:5173'
  ],
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'soul-resonances-api', ts: new Date().toISOString() });
});

// Routes
app.use('/api/webhooks', stripeRouter);
app.use('/api/content', contentRouter);
app.use('/api/auth', authRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Soul Resonances API running on port ${PORT}`);
});
