const PRODUCTION_ORIGIN = 'https://justyourmemories.company';
const LOCAL_DEV_API = 'http://localhost:3000';

function isProductionHost(hostname) {
  return hostname === 'justyourmemories.company' || hostname.endsWith('.justyourmemories.company');
}

function isLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;

  if (isProductionHost(hostname)) {
    return '';
  }

  if (protocol === 'file:') {
    return PRODUCTION_ORIGIN;
  }

  const devPorts = new Set(['5500', '5501', '5173', '5174', '8080', '4173', '8888']);
  if (isLocalDevHost(hostname) && port && port !== '3000' && devPorts.has(port)) {
    return LOCAL_DEV_API;
  }

  return '';
}

function getApiErrorMessage() {
  if (typeof window === 'undefined') {
    return 'Could not reach the server.';
  }

  const { protocol, hostname } = window.location;

  if (isProductionHost(hostname)) {
    return 'Could not reach the server. Please try again in a moment.';
  }

  if (protocol === 'file:') {
    return `Could not reach the server. Open ${PRODUCTION_ORIGIN} in your browser.`;
  }

  return `Could not reach the server. Visit ${PRODUCTION_ORIGIN} or run npm start locally.`;
}

function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${normalized}`;
}

async function fetchJson(url, options) {
  const res = await fetch(apiUrl(url), options);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(getApiErrorMessage());
    }
  }
  return { res, data };
}
