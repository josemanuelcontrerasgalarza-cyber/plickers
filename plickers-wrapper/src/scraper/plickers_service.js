// src/scraper/plickers_service.js
// Kratos Labs · Plickers Scraper Service
//
// ESTRATEGIA HÍBRIDA:
// 1. Playwright lanza Chromium headless
// 2. Autentica vía sesión guardada (storageState, para cuentas Google/SSO)
//    o, si no hay sesión, con email+password del .env
// 3. Intercepta API interna JSON de Plickers (primaria)
// 4. Fallback a scraping DOM si la API cambia

import { chromium } from 'playwright';
import logger from '../utils/logger.js';
import {
  PlickersAuthError,
  PlickersDOMChangedError,
  PlickersTimeoutError,
  PlickersClassNotFoundError,
  PlickersDataParseError,
} from '../utils/errors.js';
import { URLS, LOGIN, REPORTS, TIMEOUTS } from './selectors.js';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ruta del archivo de sesión persistida (cookies + localStorage).
// Se usa para cuentas con "Iniciar sesión con Google" / SSO — donde no hay
// password que automatizar — y para acelerar corridas subsecuentes.
// Coincide con el patrón *.session.json del .gitignore (nunca se commitea).
export const SESSION_PATH =
  process.env.PLICKERS_SESSION_PATH ||
  path.join(__dirname, '../../plickers.session.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSelector(page, selector, stepName, timeout = TIMEOUTS.ELEMENT_WAIT) {
  try {
    await page.waitForSelector(selector, { timeout, state: 'visible' });
  } catch {
    throw new PlickersDOMChangedError(selector, { step: stepName });
  }
}

async function waitForNetworkIdle(page, ms = TIMEOUTS.NETWORK_IDLE) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {
    logger.warn('waitForNetworkIdle timeout — continuando de todas formas');
  });
}

async function authenticate(page) {
  logger.info('→ Navegando al login de Plickers...');
  await page.goto(URLS.LOGIN, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
  await waitForNetworkIdle(page);

  // 1) ¿Sesión restaurada desde storageState? Plickers redirige fuera de /login
  //    a los usuarios ya autenticados.
  if (!page.url().includes('/login')) {
    logger.info('✓ Sesión restaurada (storageState), login omitido');
    return;
  }
  const successEl = await page.$(LOGIN.SUCCESS_INDICATOR).catch(() => null);
  const emailEl = await page.$(LOGIN.EMAIL_INPUT).catch(() => null);
  if (successEl || !emailEl) {
    logger.info('✓ Sesión ya activa, saltando login');
    return;
  }

  // 2) Hay formulario de login pero no hay password configurado: la cuenta usa
  //    "Iniciar sesión con Google" / SSO. NO automatizamos ese flujo (Google lo
  //    bloquea por seguridad); pedimos correr el login interactivo una vez.
  if (!process.env.PLICKERS_PASSWORD) {
    throw new PlickersAuthError(
      'No hay sesión guardada y no hay PLICKERS_PASSWORD. Si tu cuenta usa ' +
        '"Iniciar sesión con Google", ejecuta `npm run login` una vez para ' +
        'autenticarte manualmente y guardar la sesión.',
      { hint: 'Ejecuta: npm run login' }
    );
  }

  // 3) Login clásico email + password.
  await waitForSelector(page, LOGIN.EMAIL_INPUT, 'email_input');
  await page.fill(LOGIN.EMAIL_INPUT, process.env.PLICKERS_EMAIL);
  await sleep(TIMEOUTS.BETWEEN_ACTIONS);

  await waitForSelector(page, LOGIN.PASSWORD_INPUT, 'password_input');
  await page.fill(LOGIN.PASSWORD_INPUT, process.env.PLICKERS_PASSWORD);
  await sleep(TIMEOUTS.BETWEEN_ACTIONS);

  logger.info('→ Enviando credenciales...');
  await Promise.all([
    page.waitForNavigation({ timeout: TIMEOUTS.NAVIGATION, waitUntil: 'domcontentloaded' }),
    page.click(LOGIN.SUBMIT_BUTTON),
  ]).catch(async () => {
    await waitForNetworkIdle(page);
  });

  const errorEl = await page.$(LOGIN.ERROR_MESSAGE);
  if (errorEl) {
    const errorText = await errorEl.innerText().catch(() => 'Error desconocido');
    throw new PlickersAuthError(`Login fallido: ${errorText.trim()}`);
  }

  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    throw new PlickersAuthError('Login fallido: seguimos en la página de login.', {
      currentUrl,
      hint: 'Verifica PLICKERS_EMAIL y PLICKERS_PASSWORD en tu .env',
    });
  }

  logger.info('✓ Autenticación exitosa');
}

async function interceptAPIData(page, classId) {
  logger.info('→ Activando intercepción de API interna...');
  const capturedData = { classInfo: null, sessions: null, results: {} };

  page.on('response', async (response) => {
    const url = response.url();
    if (response.status() !== 200) return;
    try {
      if (url.includes(`/classes/${classId}`) && !url.includes('sessions')) {
        capturedData.classInfo = await response.json();
        logger.debug(`Capturado classInfo desde: ${url}`);
      }
      if (url.includes('sessions') && url.includes(classId)) {
        capturedData.sessions = await response.json();
        logger.debug(`Capturado sessions desde: ${url}`);
      }
      if (url.match(/sessions\/[a-zA-Z0-9]+\/results/)) {
        const sessionId = url.match(/sessions\/([a-zA-Z0-9]+)\/results/)?.[1];
        if (sessionId) {
          capturedData.results[sessionId] = await response.json();
          logger.debug(`Capturado results de sesión: ${sessionId}`);
        }
      }
    } catch { /* no es JSON */ }
  });

  return capturedData;
}

async function fetchAPIDirectly(page, classId) {
  logger.info('→ Intentando fetch directo a API interna de Plickers...');
  try {
    const classData = await page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, URLS.API_CLASS(classId));

    const sessionsData = await page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, URLS.API_SESSIONS(classId));

    logger.info(`✓ Fetch directo exitoso — ${sessionsData?.length || 0} sesiones`);
    return { classData, sessionsData };
  } catch (err) {
    logger.warn(`Fetch directo falló: ${err.message} — usando fallback DOM`);
    return null;
  }
}

async function scrapeReportsDOM(page, classId) {
  logger.info('→ [Fallback] Scraping DOM de reportes...');
  await page.goto(URLS.REPORTS(classId), { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
  await waitForNetworkIdle(page);

  const notFound = await page.$('[class*="not-found"], [class*="404"], [class*="error-page"]');
  if (notFound) throw new PlickersClassNotFoundError(classId);

  await waitForSelector(page, REPORTS.SESSION_ROW, 'session_rows');

  const rawData = await page.evaluate((selectors) => {
    const sessionRows = document.querySelectorAll(selectors.SESSION_ROW);
    const sessions = [];
    sessionRows.forEach((row) => {
      const dateEl = row.querySelector(selectors.SESSION_DATE);
      const titleEl = row.querySelector(selectors.SESSION_TITLE);
      const studentRows = row.querySelectorAll(selectors.STUDENT_ROW);
      const students = [];
      studentRows.forEach((sRow) => {
        students.push({
          name: sRow.querySelector(selectors.STUDENT_NAME)?.innerText?.trim() || null,
          rawScore: sRow.querySelector(selectors.STUDENT_SCORE)?.innerText?.trim() || null,
        });
      });
      sessions.push({
        date: dateEl?.innerText?.trim() || null,
        title: titleEl?.innerText?.trim() || null,
        students,
      });
    });
    return sessions;
  }, REPORTS);

  if (!rawData || rawData.length === 0) {
    throw new PlickersDataParseError('Scraping DOM no encontró sesiones.');
  }

  logger.info(`✓ [Fallback DOM] ${rawData.length} sesiones extraídas`);
  return { source: 'dom', sessions: rawData };
}

export async function extractPlickersData(classId = process.env.PLICKERS_CLASS_ID) {
  const hasSession = existsSync(SESSION_PATH);
  if (!hasSession && (!process.env.PLICKERS_EMAIL || !process.env.PLICKERS_PASSWORD)) {
    throw new PlickersAuthError(
      'Sin sesión guardada y sin credenciales. Ejecuta `npm run login` ' +
        '(cuentas con Google/SSO) o define PLICKERS_EMAIL y PLICKERS_PASSWORD en el .env.'
    );
  }
  if (!classId) {
    throw new PlickersClassNotFoundError('No se especificó PLICKERS_CLASS_ID');
  }

  logger.info(`\n${'═'.repeat(50)}`);
  logger.info(`KRATOS LABS — Plickers Extractor`);
  logger.info(`Clase: ${classId}`);
  logger.info(`${'═'.repeat(50)}\n`);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'es-CO',
    };
    if (hasSession) {
      contextOptions.storageState = SESSION_PATH;
      logger.info('→ Cargando sesión guardada (storageState)');
    }
    const context = await browser.newContext(contextOptions);

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.PAGE_LOAD);

    await interceptAPIData(page, classId);
    await authenticate(page);

    // Refresca/persiste la sesión para acelerar próximas corridas y mantener
    // vivas las cookies (también beneficia al login clásico email+password).
    await context
      .storageState({ path: SESSION_PATH })
      .then(() => logger.debug('Sesión persistida en disco'))
      .catch(() => {});

    logger.info(`→ Navegando a la clase: ${URLS.CLASS(classId)}`);
    await page.goto(URLS.CLASS(classId), { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
    await waitForNetworkIdle(page);

    const apiData = await fetchAPIDirectly(page, classId);

    if (apiData && apiData.sessionsData) {
      const sessionResults = {};
      const sessions = Array.isArray(apiData.sessionsData)
        ? apiData.sessionsData
        : apiData.sessionsData?.sessions || [];

      for (const session of sessions.slice(0, 50)) {
        const sessionId = session._id || session.id;
        if (!sessionId) continue;
        try {
          const results = await page.evaluate(async (url) => {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) return null;
            return res.json();
          }, URLS.API_RESULTS(sessionId));

          if (results) {
            sessionResults[sessionId] = results;
            logger.debug(`  ✓ Resultados sesión ${sessionId}`);
          }
          await sleep(300);
        } catch (err) {
          logger.warn(`  ✗ Sesión ${sessionId}: ${err.message}`);
        }
      }

      logger.info(`\n✅ Extracción completa — ${sessions.length} sesiones\n`);
      return {
        source: 'api_intercept',
        classId,
        classData: apiData.classData,
        sessions,
        sessionResults,
        extractedAt: new Date().toISOString(),
      };
    }

    logger.warn('API interna no respondió — usando fallback DOM...');
    const domData = await scrapeReportsDOM(page, classId);
    return { source: 'dom_scrape', classId, ...domData, extractedAt: new Date().toISOString() };

  } catch (err) {
    const known = ['PlickersAuthError','PlickersDOMChangedError','PlickersClassNotFoundError','PlickersDataParseError'];
    if (known.includes(err.name)) throw err;
    if (err.message?.includes('timeout') || err.message?.includes('Timeout')) {
      throw new PlickersTimeoutError('scraping_general', TIMEOUTS.PAGE_LOAD);
    }
    logger.error('Error inesperado:', { message: err.message, stack: err.stack });
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      logger.debug('Browser cerrado');
    }
  }
}
