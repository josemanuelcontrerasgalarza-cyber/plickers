// src/scraper/selectors.js
// ─────────────────────────────────────────────────────────────
//  Kratos Labs · Plickers DOM Selectors
//
//  ⚠️  ARCHIVO CRÍTICO DE MANTENIMIENTO
//  Si Plickers actualiza su UI y el scraper falla con
//  PlickersDOMChangedError, actualiza los selectores aquí.
// ─────────────────────────────────────────────────────────────

export const URLS = {
  BASE:    'https://plickers.com',
  LOGIN:   'https://plickers.com/login',
  CLASSES: 'https://plickers.com/classes',
  CLASS:   (classId) => `https://plickers.com/classes/${classId}`,
  REPORTS: (classId) => `https://plickers.com/classes/${classId}/reports`,
  API_ME:        'https://api.plickers.com/api/v3/me',
  API_CLASSES:   'https://api.plickers.com/api/v3/classes',
  API_CLASS:     (classId) => `https://api.plickers.com/api/v3/classes/${classId}`,
  API_SESSIONS:  (classId) => `https://api.plickers.com/api/v3/sessions?classId=${classId}`,
  API_RESULTS:   (sessionId) => `https://api.plickers.com/api/v3/sessions/${sessionId}/results`,
};

export const LOGIN = {
  EMAIL_INPUT:    'input[name="email"], input[type="email"], #email',
  PASSWORD_INPUT: 'input[name="password"], input[type="password"], #password',
  SUBMIT_BUTTON:  'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")',
  GOOGLE_BUTTON:  'button:has-text("Google"), a:has-text("Google"), [class*="google"], [class*="Google"]',
  ERROR_MESSAGE:  '[class*="error"], [class*="Error"], .alert, [role="alert"]',
  SUCCESS_INDICATOR: '[class*="dashboard"], [class*="home"], nav[class*="main"], .classes-list',
};

export const CLASSES = {
  CLASS_CARD:  '[class*="class-card"], [class*="ClassCard"], [data-testid*="class"]',
  CLASS_TITLE: '[class*="class-name"], [class*="className"], h2, h3',
  CLASS_LINK:  'a[href*="/classes/"]',
};

export const REPORTS = {
  SESSION_ROW:   '[class*="session-row"], [class*="SessionRow"], tr[class*="session"]',
  SESSION_DATE:  '[class*="session-date"], [class*="date"], td:first-child',
  SESSION_TITLE: '[class*="session-title"], [class*="title"]',
  STUDENT_ROW:   '[class*="student-row"], [class*="StudentRow"], tr[class*="student"]',
  STUDENT_NAME:  '[class*="student-name"], [class*="studentName"], td:first-child',
  STUDENT_SCORE: '[class*="score"], [class*="Score"], td:last-child',
};

export const TIMEOUTS = {
  PAGE_LOAD:       parseInt(process.env.SCRAPER_TIMEOUT) || 30_000,
  NAVIGATION:      15_000,
  ELEMENT_WAIT:    10_000,
  NETWORK_IDLE:    5_000,
  BETWEEN_ACTIONS: 800,
};
