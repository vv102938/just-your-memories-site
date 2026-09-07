const AUTH_KEY = 'jym_auth';

function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

function setAuth(data) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY);
}

function setGuest() {
  setAuth({ mode: 'guest', name: 'Guest' });
}

function setUserSession(data) {
  setAuth({
    mode: 'user',
    token: data.token,
    role: data.role,
    name: data.name,
    email: data.email,
    shipping: data.shipping || null
  });
}

function isLoggedIn() {
  const auth = getAuth();
  return auth && (auth.mode === 'guest' || auth.mode === 'user');
}

function isAdmin() {
  const auth = getAuth();
  return auth?.mode === 'user' && auth.role === 'admin';
}

function requireShopAccess() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function requireAdminAccess() {
  const auth = getAuth();
  if (!auth || auth.mode !== 'user' || auth.role !== 'admin' || !auth.token) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function authHeaders() {
  const auth = getAuth();
  if (auth?.token) {
    return { Authorization: 'Bearer ' + auth.token };
  }
  return {};
}

function logout() {
  clearAuth();
  window.location.href = 'index.html';
}

function updateUserSession(updates) {
  const auth = getAuth();
  if (auth?.mode !== 'user') return;
  setAuth({ ...auth, ...updates });
}

function getAccountInitial(name) {
  const clean = String(name || 'A').trim();
  return clean.charAt(0).toUpperCase();
}

function initAccountNav() {
  const auth = getAuth();
  const link = document.getElementById('accountNavLink');
  const avatar = document.getElementById('accountNavAvatar');
  const label = document.getElementById('accountNavLabel');

  if (!link) return;

  if (!isLoggedIn()) {
    link.href = 'index.html';
    if (label) label.textContent = 'Sign in';
    if (avatar) avatar.textContent = '?';
    return;
  }

  link.href = 'account.html';
  if (label) {
    label.textContent = auth.mode === 'guest' ? 'Guest' : (auth.name || 'Account');
  }
  if (avatar) {
    avatar.textContent = auth.mode === 'guest' ? 'G' : getAccountInitial(auth.name);
  }
}

function isCustomerAccount() {
  const auth = getAuth();
  return auth?.mode === 'user' && !!auth.token && auth.role !== 'admin';
}

function getAccountCheckoutDefaults() {
  const auth = getAuth();
  if (!isCustomerAccount()) return null;
  const ship = auth.shipping || {};
  return {
    name: auth.name || '',
    email: auth.email || '',
    address: ship.address || '',
    city: ship.city || '',
    state: ship.state || '',
    zip: ship.zip || ''
  };
}

function requireAccountAccess() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}
