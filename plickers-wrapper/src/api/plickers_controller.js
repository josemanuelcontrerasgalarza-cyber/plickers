// src/api/plickers_controller.js
// Kratos Labs · Plickers API Controller
// Rutas: GET /health | GET /sync | GET /sync/:classId

import { Router } from 'express';
import { extractPlickersData } from '../scraper/plickers_service.js';
import { normalizePlickersData } from '../normalizer/normalize.js';
import logger from '../utils/logger.js';

const router = Router();

function requireApiKey(req, res, next) {
  const apiKey = process.env.API_SECRET_KEY;
  if (!apiKey) return next();
  const provided = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided !== apiKey) {
    logger.warn(`API key inválida desde ${req.ip}`);
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'API key inválida. Incluye el header X-API-Key.' } });
  }
  next();
}

function handleScraperError(err, res) {
  logger.error(`[${err.name}] ${err.message}`, { code: err.code, context: err.context });

  const errorMap = {
    PlickersAuthError:        { status: 401, message: 'Autenticación con Plickers fallida.', action: 'Verifica PLICKERS_EMAIL y PLICKERS_PASSWORD en .env' },
    PlickersDOMChangedError:  { status: 503, message: 'Plickers actualizó su UI. El scraper necesita mantenimiento.', action: 'Actualizar selectores en src/scraper/selectors.js' },
    PlickersTimeoutError:     { status: 504, message: 'Timeout durante la sincronización.', action: 'Aumentar SCRAPER_TIMEOUT en .env o reintentar' },
    PlickersClassNotFoundError: { status: 404, message: err.message, action: 'Verifica PLICKERS_CLASS_ID' },
    PlickersDataParseError:   { status: 422, message: 'Datos con formato inesperado.', action: 'Revisa los logs del servidor' },
  };

  const info = errorMap[err.name] || { status: 500, message: 'Error interno inesperado.', action: 'Revisa los logs' };

  res.status(info.status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: info.message,
      action_required: info.action,
      ...(process.env.NODE_ENV !== 'production' && { debug: { original_error: err.message, context: err.context } }),
    },
    timestamp: new Date().toISOString(),
  });
}

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'plickers-wrapper',
    version: '1.0.0',
    status: 'operational',
    environment: process.env.NODE_ENV || 'development',
    config: {
      email_configured: Boolean(process.env.PLICKERS_EMAIL),
      password_configured: Boolean(process.env.PLICKERS_PASSWORD),
      class_id_configured: Boolean(process.env.PLICKERS_CLASS_ID),
      headless_mode: process.env.HEADLESS !== 'false',
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/sync/:classId?', requireApiKey, async (req, res) => {
  const classId = req.params.classId || process.env.PLICKERS_CLASS_ID;
  const startTime = Date.now();

  if (!classId) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_CLASS_ID', message: 'Especifica :classId en la URL o configura PLICKERS_CLASS_ID en .env', action_required: 'Agrega PLICKERS_CLASS_ID=tuId al archivo .env' },
    });
  }

  if (router._syncInProgress) {
    return res.status(429).json({ success: false, error: { code: 'SYNC_IN_PROGRESS', message: 'Ya hay una sincronización en curso.' } });
  }

  router._syncInProgress = true;
  logger.info(`\n⚡ Sync iniciado — clase: ${classId}`);

  try {
    const rawData = await extractPlickersData(classId);
    const normalizedData = normalizePlickersData(rawData);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`\n✅ Sync completado en ${duration}s\n`);
    res.json({ success: true, data: normalizedData, meta: { duration_seconds: parseFloat(duration), class_id: classId } });
  } catch (err) {
    handleScraperError(err, res);
  } finally {
    router._syncInProgress = false;
  }
});

export default router;
