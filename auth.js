const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.MONGODB_URI;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ? String(process.env.ADMIN_PASSWORD).trim() : '';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = Buffer.from(test, 'hex');
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

function createToken(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function requireAdmin(req, res, next) {
  const data = verifyToken(getBearerToken(req));
  if (!data || data.role !== 'admin') {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  req.auth = data;
  next();
}

function isAdminConfigured() {
  return Boolean(ADMIN_PASSWORD);
}

function matchesAdminLogin(identifier, password) {
  if (!ADMIN_PASSWORD || !password) return false;
  const id = String(identifier || '').trim().toLowerCase();
  const allowed = new Set([ADMIN_USERNAME]);
  if (ADMIN_EMAIL) allowed.add(ADMIN_EMAIL);
  if (!allowed.has(id)) return false;

  const passBuf = Buffer.from(password);
  const adminBuf = Buffer.from(ADMIN_PASSWORD);
  if (passBuf.length !== adminBuf.length) return false;
  return crypto.timingSafeEqual(passBuf, adminBuf);
}

function validatePasswordStrength(password) {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number.';
  }
  return null;
}

function validateSignupName(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length < 2) {
    return 'Enter your name.';
  }
  if (!/^[A-Za-z][A-Za-z\s.'-]{0,78}[A-Za-z.']?$/.test(cleanName)) {
    return 'Use letters, spaces, hyphens, or apostrophes only.';
  }
  if (!/\s/.test(cleanName)) {
    return 'Enter both first and last name.';
  }
  return null;
}

function validateSignupInput(name, email, password) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  const nameErr = validateSignupName(cleanName);
  if (nameErr) {
    return { error: nameErr };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
    return { error: 'Enter a valid email address.' };
  }
  const passwordErr = validatePasswordStrength(cleanPassword);
  if (passwordErr) {
    return { error: passwordErr };
  }
  if (cleanEmail === ADMIN_EMAIL || cleanEmail === ADMIN_USERNAME) {
    return { error: 'That email is reserved. Use a different email to sign up.' };
  }
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
}

function generateVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(String(code).trim()).digest('hex');
}

function verifyVerificationCode(code, storedHash) {
  const hash = hashVerificationCode(code);
  const hashBuf = Buffer.from(hash, 'hex');
  const storedBuf = Buffer.from(String(storedHash || ''), 'hex');
  if (hashBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, storedBuf);
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

module.exports = {
  ADMIN_EMAIL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  VERIFICATION_CODE_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getBearerToken,
  requireAdmin,
  isAdminConfigured,
  matchesAdminLogin,
  validateSignupInput,
  validateSignupName,
  validatePasswordStrength,
  generateVerificationCode,
  hashVerificationCode,
  verifyVerificationCode,
  maskEmail
};
