function getApiBase() {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  if (protocol === 'file:') return 'http://localhost:3000';
  const devPorts = new Set(['5500', '5501', '5173', '5174', '8080', '4173', '8888']);
  if (port && port !== '3000' && devPorts.has(port)) {
    return `http://${hostname}:3000`;
  }
  return '';
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
      throw new Error('Could not reach the API server. Run npm start and open http://localhost:3000 — not Live Server or the HTML file directly.');
    }
  }
  return { res, data };
}
