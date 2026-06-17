// src/index.js
// Kratos Labs · Plickers Wrapper — Entry Point

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { mkdirSync } from 'fs';
import plickersRouter from './api/plickers_controller.js';
import logger from './utils/logger.js';

try { mkdirSync('./logs', { recursive: true }); } catch {}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000','http://localhost:5173','http://localhost:8000','http://127.0.0.1:3000'],
  methods: ['GET'],
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Máximo 10 syncs por minuto.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/plickers', limiter, plickersRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Ruta ${req.method} ${req.path} no existe` },
    available_routes: ['GET /api/plickers/health','GET /api/plickers/sync','GET /api/plickers/sync/:classId'],
  });
});

app.use((err, req, res, _next) => {
  logger.error('Error no capturado en Express:', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
});

app.listen(PORT, () => {
  logger.info(`\n${'═'.repeat(50)}`);
  logger.info('  KRATOS LABS — Plickers Wrapper');
  logger.info(`  http://localhost:${PORT}/api/plickers/health`);
  logger.info(`  http://localhost:${PORT}/api/plickers/sync`);
  logger.info(`${'═'.repeat(50)}\n`);
});

export default app;
