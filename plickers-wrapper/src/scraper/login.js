// src/scraper/login.js
// Kratos Labs · Login interactivo (one-time) para cuentas con Google / SSO
//
// ¿Por qué existe este script?
// Plickers (y Google) bloquean el login automatizado de "Iniciar sesión con
// Google" en navegadores headless por seguridad. La solución robusta es iniciar
// sesión UNA vez de forma manual en un navegador visible y guardar la sesión
// (cookies + localStorage). El scraper luego la reutiliza vía storageState y ya
// no necesita volver a autenticarse hasta que la sesión expire.
//
// Uso:   npm run login
// Nota:  requiere un entorno con interfaz gráfica (display). Córrelo en tu
//        máquina local, no en un servidor headless.

import 'dotenv/config';
import readline from 'readline';
import { chromium } from 'playwright';
import { URLS } from './selectors.js';
import { SESSION_PATH } from './plickers_service.js';

const FIVE_MIN = 5 * 60_000;

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve('enter');
    });
  });
}

async function main() {
  console.log(`
─────────────────────────────────────────────────────────────
  KRATOS LABS · Login interactivo de Plickers (Google / SSO)
─────────────────────────────────────────────────────────────
  Se abrirá una ventana de Chromium. Haz clic en
  "Iniciar sesión con Google" y completa el flujo (incluido 2FA
  si lo tienes activado). Cuando veas tu panel de Plickers,
  vuelve a esta terminal.
─────────────────────────────────────────────────────────────
`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-CO',
  });

  const page = await context.newPage();
  await page.goto(URLS.LOGIN, { waitUntil: 'domcontentloaded' });

  // Detecta automáticamente cuando vuelves a Plickers ya autenticado,
  // o permite forzar el guardado pulsando ENTER en la terminal.
  const dashboard = page
    .waitForURL(
      (url) => {
        const s = String(url);
        return s.includes('plickers.com') && !s.includes('/login');
      },
      { timeout: FIVE_MIN }
    )
    .then(() => 'url')
    .catch(() => null);

  const enter = waitForEnter(
    '👉 Cuando hayas iniciado sesión y veas tu panel, pulsa ENTER aquí para guardar la sesión...\n'
  );

  await Promise.race([dashboard, enter]);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (page.url().includes('/login')) {
    console.warn(
      '⚠️  Parece que sigues en la página de login. Guardaré la sesión igual, ' +
        'pero si el scraper falla con AUTH_FAILED, vuelve a ejecutar `npm run login`.'
    );
  }

  await context.storageState({ path: SESSION_PATH });
  console.log(`\n✅ Sesión guardada en:\n   ${SESSION_PATH}\n`);
  console.log('Ya puedes usar el scraper:  npm start  →  GET /api/plickers/sync\n');

  await browser.close();
}

main().catch((err) => {
  console.error('\n❌ Error durante el login interactivo:', err.message);
  process.exit(1);
});
