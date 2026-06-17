# plickers-wrapper

> **Kratos Labs** · API Wrapper para [Plickers](https://plickers.com)
>
> Servicio Node.js que actúa como API Wrapper para Plickers (que no tiene API
> pública oficial). Usa un browser headless (Playwright + Chromium) para
> autenticarse, extraer datos de evaluaciones y exponerlos vía un endpoint
> REST local, normalizados a un esquema estable y predecible.

---

## ⚠️ Aviso

Plickers **no** ofrece una API pública oficial. Este wrapper automatiza el
acceso con tus **propias credenciales** a tus **propios datos**. Úsalo de forma
responsable, respetando los Términos de Servicio de Plickers y la normativa de
protección de datos de tus estudiantes (FERPA / GDPR / habeas data según
corresponda). Las credenciales **nunca** se hardcodean: viven solo en tu `.env`
local (ignorado por git).

---

## 🏗️ Arquitectura

```
                 ┌─────────────────────────────────────────────┐
   HTTP GET ───▶ │  Express  (src/index.js)                    │
                 │   ├─ helmet, cors, rate-limit (10/min)      │
                 │   └─ /api/plickers/* (plickers_controller)  │
                 └───────────────────┬─────────────────────────┘
                                     │
                 ┌───────────────────▼─────────────────────────┐
                 │  Scraper  (scraper/plickers_service.js)     │
                 │   1. Playwright lanza Chromium headless     │
                 │   2. Login con credenciales del .env        │
                 │   3. Fetch directo a la API interna (JSON)  │  ← primaria
                 │   4. Fallback: scraping del DOM de reportes │  ← respaldo
                 └───────────────────┬─────────────────────────┘
                                     │  raw data
                 ┌───────────────────▼─────────────────────────┐
                 │  Normalizer  (normalizer/normalize.js)      │
                 │   → esquema estable garantizado             │
                 └───────────────────┬─────────────────────────┘
                                     │
                                 JSON estable
```

**Estrategia híbrida:** se intenta primero la **API interna** de Plickers
(rápida y estructurada). Si Plickers cambia esa API, el scraper cae al
**fallback de DOM**. Si el DOM también cambia, falla de forma explícita con
`PlickersDOMChangedError`, indicando que hay que actualizar
[`src/scraper/selectors.js`](src/scraper/selectors.js).

---

## 📂 Estructura

```
plickers-wrapper/
├── src/
│   ├── scraper/
│   │   ├── plickers_service.js   # Orquestación Playwright (login + extracción)
│   │   └── selectors.js          # ⚠️ Selectores DOM + URLs (mantenimiento)
│   ├── normalizer/
│   │   └── normalize.js          # Raw → esquema estable
│   ├── api/
│   │   └── plickers_controller.js# Rutas REST + manejo de errores
│   ├── utils/
│   │   ├── logger.js             # Winston (consola + archivos en logs/)
│   │   └── errors.js             # Clases de error tipadas
│   └── index.js                  # Entry point Express
├── tests/
│   └── test.js                   # Tests del normalizador (sin browser)
├── logs/                         # Logs generados (gitignored)
├── .env.example                  # Plantilla de configuración
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Instalación

Requiere **Node.js >= 18** (probado en Node 22).

```bash
# 1. Instalar dependencias
npm install            # si falla por peer deps: npm install --legacy-peer-deps

# 2. Instalar el browser headless de Playwright
npx playwright install chromium

# 3. Configurar credenciales
cp .env.example .env
#    edita .env con tu email, password y class id reales
```

### Variables de entorno (`.env`)

| Variable            | Descripción                                              | Default       |
| ------------------- | -------------------------------------------------------- | ------------- |
| `PLICKERS_EMAIL`    | Email de tu cuenta Plickers                              | —             |
| `PLICKERS_PASSWORD` | Password (déjalo **vacío** si entras con Google, ver abajo) | —          |
| `PLICKERS_CLASS_ID` | ID de clase por defecto (opcional si lo pasas en la URL) | —             |
| `PORT`              | Puerto del servidor HTTP                                 | `3000`        |
| `NODE_ENV`          | `development` \| `production`                            | `development` |
| `API_SECRET_KEY`    | Clave para proteger `/sync` (header `X-API-Key`)         | —             |
| `HEADLESS`          | `true` \| `false` (ver el browser para depurar)          | `true`        |
| `SCRAPER_TIMEOUT`   | Timeout de carga de página, en ms                        | `30000`       |
| `PLICKERS_SESSION_PATH` | Ruta del archivo de sesión guardada                 | `./plickers.session.json` |

> Si `API_SECRET_KEY` está vacío, el endpoint `/sync` queda **sin** protección
> de API key (útil solo para desarrollo local).

---

## 🔐 Autenticación con Google / SSO

Si tu cuenta de Plickers se creó con **"Iniciar sesión con Google"** (u otro
SSO), **no** hay un password que el scraper pueda automatizar — y Google
**bloquea** activamente el login automatizado en navegadores headless. La
solución es iniciar sesión **una sola vez** de forma manual y guardar la sesión:

```bash
# Córrelo en tu máquina LOCAL (necesita interfaz gráfica / display)
npm run login
```

1. Se abre una ventana de Chromium **visible**.
2. Haz clic en **"Iniciar sesión con Google"** y completa el flujo (incluido 2FA).
3. Cuando veas tu panel de Plickers, vuelve a la terminal y pulsa **ENTER**.
4. Se guarda la sesión en `plickers.session.json` (cookies + localStorage).

A partir de ahí, el scraper carga esa sesión automáticamente (`storageState`) y
**omite el login**. La sesión se refresca en cada corrida exitosa. Cuando expire
(Plickers vuelve a pedir login), simplemente repite `npm run login`.

| | Cuenta con Google / SSO | Cuenta email + password |
|---|---|---|
| `.env` | `PLICKERS_PASSWORD` vacío | `PLICKERS_EMAIL` + `PLICKERS_PASSWORD` |
| Login | `npm run login` (una vez) | automático en cada sync |
| Sesión | `plickers.session.json` (obligatoria) | se cachea como bonus |

> 🔒 `plickers.session.json` contiene tokens de sesión válidos: está en
> `.gitignore` (`*.session.json`) y **nunca** debe commitearse ni compartirse.
> Es tan sensible como tu password.
>
> 💡 Alternativa sin sesión: si Plickers te permite **establecer un password**
> en los ajustes de tu cuenta (aun habiéndola creado con Google), puedes usar el
> login clásico email + password rellenando `PLICKERS_PASSWORD` en el `.env`.

---

## ▶️ Uso

```bash
npm start      # producción
npm run dev    # desarrollo con recarga (nodemon)
```

### Endpoints

Todas las rutas viven bajo `/api/plickers` y están limitadas a **10 req/min**.

#### `GET /api/plickers/health`

Healthcheck. No requiere API key.

```bash
curl http://localhost:3000/api/plickers/health
```

```json
{ "success": true, "status": "operational", "...": "..." }
```

#### `GET /api/plickers/sync` · `GET /api/plickers/sync/:classId`

Lanza el scraper, normaliza y devuelve los datos. Requiere `X-API-Key` si
`API_SECRET_KEY` está configurada.

```bash
curl -H "X-API-Key: tu-secret" \
     http://localhost:3000/api/plickers/sync/CLASS_ID_AQUI
```

Si no pasas `:classId`, se usa `PLICKERS_CLASS_ID` del `.env`.

### Esquema de respuesta normalizado

```jsonc
{
  "success": true,
  "data": {
    "sync_id": "uuid",
    "synced_at": "ISO-8601",
    "class_id": "...",
    "class_name": "6to Grado A",
    "source": "api_intercept | dom_scrape",
    "extracted_at": "ISO-8601",
    "sessions": [
      {
        "session_id": "...",
        "session_title": "Matemáticas - Fracciones",
        "session_date": "ISO-8601",
        "total_questions": 5,
        "students": [
          {
            "student_id": "...",
            "student_name": "Ana García",
            "questions_answered": 5,
            "questions_correct": 4,
            "score": 80,
            "answers": [
              { "question_id": "q1", "answer": "A", "is_correct": true }
            ]
          }
        ]
      }
    ],
    "summary": { "total_sessions": 2, "total_students": 2, "avg_score": 80 }
  },
  "meta": { "duration_seconds": 12.34, "class_id": "..." }
}
```

`score` se normaliza siempre a un entero **0–100**, sin importar si la fuente lo
entrega como fracción (`0.8`), porcentaje (`"90%"`) o ratio (`"7/10"`).

---

## 🧪 Tests

Los tests del normalizador corren **sin browser** (datos mock) y deben pasar
**24/24**:

```bash
npm test
# → Resultado: 24 ✅ passed, 0 ❌ failed
```

---

## 🛠️ Manejo de errores

El controlador mapea cada error tipado a un status HTTP y una acción sugerida:

| Error                         | HTTP | Acción requerida                                  |
| ----------------------------- | ---- | ------------------------------------------------- |
| `PlickersAuthError`           | 401  | Verifica `PLICKERS_EMAIL` / `PLICKERS_PASSWORD`   |
| `PlickersClassNotFoundError`  | 404  | Verifica `PLICKERS_CLASS_ID`                      |
| `PlickersDataParseError`      | 422  | Revisa los logs del servidor                      |
| `PlickersDOMChangedError`     | 503  | Actualiza `src/scraper/selectors.js`              |
| `PlickersTimeoutError`        | 504  | Sube `SCRAPER_TIMEOUT` o reintenta                |

En `NODE_ENV !== production` la respuesta incluye un bloque `debug` con el error
original y su contexto.

---

## 🔧 Mantenimiento

Si el scraper empieza a fallar con `PlickersDOMChangedError`, casi siempre es
porque Plickers actualizó su interfaz. El **único** archivo a tocar es
[`src/scraper/selectors.js`](src/scraper/selectors.js): ajusta las URLs de la
API interna y/o los selectores del DOM y vuelve a probar.

---

## 📜 Licencia

Uso interno — Kratos Labs.
