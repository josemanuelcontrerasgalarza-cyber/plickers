// src/utils/errors.js
// Kratos Labs · Custom Error Classes

export class PlickersWrapperError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', context = {}) {
    super(message);
    this.name = 'PlickersWrapperError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

export class PlickersAuthError extends PlickersWrapperError {
  constructor(message, context = {}) {
    super(message, 'AUTH_FAILED', context);
    this.name = 'PlickersAuthError';
  }
}

export class PlickersDOMChangedError extends PlickersWrapperError {
  constructor(selector, context = {}) {
    super(
      `DOM selector no encontrado: "${selector}". Plickers probablemente actualizó su interfaz.`,
      'DOM_CHANGED',
      { selector, ...context }
    );
    this.name = 'PlickersDOMChangedError';
    this.actionRequired = 'Actualizar selectores en src/scraper/selectors.js';
  }
}

export class PlickersTimeoutError extends PlickersWrapperError {
  constructor(step, timeoutMs) {
    super(
      `Timeout en paso "${step}" después de ${timeoutMs}ms.`,
      'SCRAPER_TIMEOUT',
      { step, timeoutMs }
    );
    this.name = 'PlickersTimeoutError';
  }
}

export class PlickersClassNotFoundError extends PlickersWrapperError {
  constructor(classId) {
    super(
      `Clase con ID "${classId}" no encontrada o sin acceso.`,
      'CLASS_NOT_FOUND',
      { classId }
    );
    this.name = 'PlickersClassNotFoundError';
  }
}

export class PlickersDataParseError extends PlickersWrapperError {
  constructor(message, rawData = null) {
    super(message, 'DATA_PARSE_ERROR', { rawDataSample: JSON.stringify(rawData)?.slice(0, 200) });
    this.name = 'PlickersDataParseError';
  }
}
