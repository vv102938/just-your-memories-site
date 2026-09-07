require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const zipcodes = require('zipcodes');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('./db/connect');
const { User, Order, SignupVerification } = require('./models');
const { isMailConfigured, sendOrderConfirmationEmail, sendSignupVerificationEmail, warmMailConnection, getMailStatus } = require('./email');
const { ensureUploadsDir, saveOrderItemImages } = require('./images');
const {
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
  maskEmail,
  VERIFICATION_CODE_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS
} = require('./auth');

const { getSiteUrl, PORT } = require('./config');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment. Copy .env.example to .env and set your connection string.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

function asPlain(doc) {
  if (!doc) return doc;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

function generateOrderNumber() {
  return 'JYM-' + Math.floor(100000 + Math.random() * 899999);
}

function generateConfirmationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeOrder(doc) {
  return {
    orderNumber: doc.orderNumber,
    status: doc.status,
    emailConfirmed: Boolean(doc.emailConfirmed),
    customer: {
      name: doc.customer.name,
      email: doc.customer.email,
      address: doc.customer.address,
      city: doc.customer.city,
      state: doc.customer.state,
      zip: doc.customer.zip
    },
    items: doc.items.map(item => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty: item.qty,
      imageUrl: item.imageUrl || null
    })),
    subtotal: doc.subtotal,
    shipping: doc.shipping,
    total: doc.total,
    createdAt: doc.createdAt
  };
}

function sanitizeAdminOrder(doc) {
  return {
    orderNumber: doc.orderNumber,
    status: doc.status,
    emailConfirmed: Boolean(doc.emailConfirmed),
    customer: doc.customer,
    items: doc.items.map(item => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty: item.qty,
      imageUrl: item.imageUrl || null
    })),
    subtotal: doc.subtotal,
    shipping: doc.shipping,
    total: doc.total,
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt || null
  };
}

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'
]);

const BLOCKED_EMAIL_DOMAINS = new Set([
  'doodoo.com',
  'example.com', 'example.org', 'example.net',
  'test.com', 'localhost', 'invalid.com', 'fake.com',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'tempmail.com', 'temp-mail.org', 'throwaway.email', 'yopmail.com',
  'sharklasers.com', 'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com'
]);

function validateEmailFormat(email) {
  if (!email || email.length > 120) return 'Enter a valid email address.';
  const parts = email.split('@');
  if (parts.length !== 2) return 'Enter a valid email address.';
  const [local, domain] = parts;
  if (!/^[a-zA-Z0-9._%+-]+$/.test(local) || local.length < 1 || local.length > 64) {
    return 'Enter a valid email address.';
  }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return 'Enter a valid email address.';
  }
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(domain)) {
    return 'Enter a valid email address.';
  }
  const labels = domain.split('.');
  if (labels.some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    return 'Enter a valid email address.';
  }
  return '';
}

function validateEmailDomainAllowed(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return 'Enter a valid email address.';
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return 'That email domain is not allowed. Use a real inbox you check (e.g. Gmail, Outlook, Yahoo).';
  }
  return '';
}

function validateEmailSync(email) {
  const formatErr = validateEmailFormat(email);
  if (formatErr) return formatErr;
  return validateEmailDomainAllowed(email);
}

function validateEmail(email) {
  return validateEmailSync(email);
}

function cityNameVariants(city) {
  const trimmed = city.trim().replace(/\s+/g, ' ');
  const variants = new Set([trimmed]);
  variants.add(trimmed.replace(/\bSt\.?\b/gi, 'Saint'));
  variants.add(trimmed.replace(/\bSaint\b/gi, 'St.'));
  variants.add(trimmed.replace(/\bMt\.?\b/gi, 'Mount'));
  variants.add(trimmed.replace(/\bFt\.?\b/gi, 'Fort'));
  variants.add(trimmed.replace(/\bN\s/gi, 'North '));
  variants.add(trimmed.replace(/\bNorth\s/gi, 'N '));
  variants.add(trimmed.replace(/\bS\s/gi, 'South '));
  variants.add(trimmed.replace(/\bSouth\s/gi, 'S '));
  variants.add(trimmed.replace(/\bE\s/gi, 'East '));
  variants.add(trimmed.replace(/\bEast\s/gi, 'E '));
  variants.add(trimmed.replace(/\bW\s/gi, 'West '));
  variants.add(trimmed.replace(/\bWest\s/gi, 'W '));
  return [...variants];
}

function normalizeCityKey(city) {
  return city.toLowerCase().replace(/[^a-z]/g, '');
}

function cityExistsInState(city, state) {
  const code = state.toUpperCase();
  return cityNameVariants(city).some(name => {
    const matches = zipcodes.lookupByName(name, code);
    return Array.isArray(matches) && matches.length > 0;
  });
}

function validateCityFormat(city) {
  if (!/^[A-Za-z][A-Za-z\s.'-]{0,48}[A-Za-z.'-]?$/.test(city)) {
    return 'Use letters, spaces, hyphens, or apostrophes only.';
  }
  return '';
}

function validateCityInState(city, state) {
  const formatErr = validateCityFormat(city);
  if (formatErr) return formatErr;

  const code = String(state || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || !US_STATES.has(code)) {
    return 'Enter a valid state first, then enter the city.';
  }
  if (!cityExistsInState(city, code)) {
    return `"${city}" is not a recognized US city in ${code}. Check spelling or try another city.`;
  }
  return '';
}

function validateZipState(zip, state) {
  const baseZip = zip.split('-')[0];
  const info = zipcodes.lookup(baseZip);
  if (!info) return 'That ZIP code was not found.';
  if (info.state.toUpperCase() !== state.toUpperCase()) {
    return `ZIP ${baseZip} is in ${info.state}, not ${state}.`;
  }
  return '';
}

function validateShippingAddress(city, state, zip) {
  const formatErr = validateCityFormat(city);
  if (formatErr) return formatErr;

  const zipErr = validateZipState(zip, state);
  if (zipErr) return zipErr;

  if (cityExistsInState(city, state)) return '';

  const info = zipcodes.lookup(zip.split('-')[0]);
  const cityKeys = new Set(cityNameVariants(city).map(normalizeCityKey));
  const zipCityKeys = cityNameVariants(info.city).map(normalizeCityKey);
  if (zipCityKeys.some(key => cityKeys.has(key))) return '';

  return `"${city}" is not a recognized city in ${state}. For ZIP ${zip.split('-')[0]}, try "${info.city}".`;
}

function validateCustomerFields(customer) {
  const name = String(customer?.name || '').trim();
  const email = String(customer?.email || '').trim();
  const address = String(customer?.address || '').trim();
  const city = String(customer?.city || '').trim();
  const state = String(customer?.state || '').trim().toUpperCase();
  const zip = String(customer?.zip || '').trim();

  if (!name || !email || !address || !city || !state || !zip) {
    return { error: 'Please fill in all shipping details.' };
  }
  if (!/^[A-Za-z][A-Za-z\s.'-]{0,78}[A-Za-z.']?$/.test(name) || !/\s/.test(name)) {
    return { error: 'Enter a full name with first and last name (letters only).' };
  }
  const formatErr = validateEmailSync(email);
  if (formatErr) return { error: formatErr };
  if (address.length < 5 || !/^\d+\s+[A-Za-z0-9\s.,#-]{2,}$/.test(address)) {
    return { error: 'Enter a street address starting with a number (e.g. 123 Oak Street).' };
  }
  if (!/^[A-Z]{2}$/.test(state) || !US_STATES.has(state)) {
    return { error: 'Enter a valid 2-letter US state code (e.g. CA, NY, TX).' };
  }
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    return { error: 'Enter a valid 5-digit ZIP or ZIP+4.' };
  }
  const addressErr = validateShippingAddress(city, state, zip);
  if (addressErr) return { error: addressErr };

  return {
    customer: { name, email: email.toLowerCase(), address, city, state, zip }
  };
}

function validateShippingFields(raw) {
  const address = String(raw?.address || '').trim();
  const city = String(raw?.city || '').trim();
  const state = String(raw?.state || '').trim().toUpperCase();
  const zip = String(raw?.zip || '').trim();

  if (!address || !city || !state || !zip) {
    return { error: 'Please fill in all shipping details.' };
  }
  if (address.length < 5 || !/^\d+\s+[A-Za-z0-9\s.,#-]{2,}$/.test(address)) {
    return { error: 'Enter a street address starting with a number (e.g. 123 Oak Street).' };
  }
  if (!/^[A-Z]{2}$/.test(state) || !US_STATES.has(state)) {
    return { error: 'Enter a valid 2-letter US state code (e.g. CA, NY, TX).' };
  }
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    return { error: 'Enter a valid 5-digit ZIP or ZIP+4.' };
  }
  const addressErr = validateShippingAddress(city, state, zip);
  if (addressErr) return { error: addressErr };

  return { shipping: { address, city, state, zip } };
}

function buildAuthResponse(user, token, shippingOverride) {
  return {
    token,
    role: user.role || 'customer',
    name: user.name,
    email: user.email,
    shipping: shippingOverride !== undefined ? shippingOverride : (user.shipping || null)
  };
}

async function resolveUserShipping(user) {
  if (user?.shipping?.address) {
    return user.shipping;
  }
  if (!user?.email) {
    return null;
  }

  const order = await Order.findOne({ 'customer.email': user.email })
    .sort({ createdAt: -1 })
    .select('customer')
    .lean();
  const customer = order?.customer;
  if (!customer?.address || !customer?.city || !customer?.state || !customer?.zip) {
    return null;
  }

  const shipping = {
    address: String(customer.address).trim(),
    city: String(customer.city).trim(),
    state: String(customer.state).trim().toUpperCase(),
    zip: String(customer.zip).trim()
  };

  if (user._id) {
    User.updateOne({ _id: user._id }, { $set: { shipping } }).catch((err) => {
      console.error('Could not backfill saved shipping:', err.message);
    });
  }

  return shipping;
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured on the server. Sign-up verification cannot run yet.' });
    }

    const validated = validateSignupInput(req.body?.name, req.body?.email, req.body?.password);
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    const shippingValidated = validateShippingFields(req.body);
    if (shippingValidated.error) {
      return res.status(400).json({ error: shippingValidated.error });
    }

    const emailErr = validateEmail(validated.email);
    if (emailErr) {
      return res.status(400).json({ error: emailErr });
    }

    const existing = await User.findOne({ email: validated.email }).lean();
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }

    const code = generateVerificationCode();
    const now = new Date();
    const pending = {
      email: validated.email,
      name: validated.name,
      passwordHash: hashPassword(validated.password),
      shipping: shippingValidated.shipping,
      codeHash: hashVerificationCode(code),
      attempts: 0,
      expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
      lastSentAt: now
    };

    await SignupVerification.findOneAndUpdate(
      { email: validated.email },
      pending,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendSignupVerificationEmail(validated.name, validated.email, code);
    if (!sent) {
      return res.status(503).json({ error: 'Could not send the verification email. Try again in a moment.' });
    }

    res.json({
      ok: true,
      verificationRequired: true,
      email: validated.email,
      maskedEmail: maskEmail(validated.email),
      expiresInMinutes: Math.round(VERIFICATION_CODE_TTL_MS / 60000)
    });
  } catch (err) {
    console.error('POST /api/auth/signup failed:', err);
    res.status(500).json({ error: 'Could not start sign up.' });
  }
});

app.post('/api/auth/signup/verify', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();

    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
    }

    const pending = await SignupVerification.findOne({ email }).lean();
    if (!pending) {
      return res.status(404).json({ error: 'No sign-up in progress for that email. Start sign up again.' });
    }

    if (pending.expiresAt <= new Date()) {
      await SignupVerification.deleteOne({ email });
      return res.status(410).json({ error: 'That code expired. Start sign up again to get a new one.' });
    }

    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      await SignupVerification.deleteOne({ email });
      return res.status(429).json({ error: 'Too many wrong attempts. Start sign up again to get a new code.' });
    }

    if (!verifyVerificationCode(code, pending.codeHash)) {
      await SignupVerification.updateOne({ email }, { $inc: { attempts: 1 } });
      const remaining = MAX_VERIFY_ATTEMPTS - pending.attempts - 1;
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Incorrect code. Start sign up again to get a new one.'
      });
    }

    const nameErr = validateSignupName(pending.name);
    if (nameErr) {
      await SignupVerification.deleteOne({ email });
      return res.status(400).json({ error: nameErr });
    }

    const emailErr = validateEmail(pending.email);
    if (emailErr) {
      await SignupVerification.deleteOne({ email });
      return res.status(400).json({ error: emailErr });
    }

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      await SignupVerification.deleteOne({ email });
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }

    const user = await User.create({
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
      shipping: pending.shipping || undefined,
      role: 'customer',
      emailVerified: true
    });
    await SignupVerification.deleteOne({ email });

    const token = createToken({
      role: 'customer',
      userId: String(user._id),
      email: user.email,
      name: user.name
    });

    res.status(201).json(buildAuthResponse(asPlain(user), token));
  } catch (err) {
    console.error('POST /api/auth/signup/verify failed:', err);
    res.status(500).json({ error: 'Could not verify your email.' });
  }
});

app.post('/api/auth/signup/resend', async (req, res) => {
  try {
    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured on the server.' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const pending = await SignupVerification.findOne({ email }).lean();
    if (!pending) {
      return res.status(404).json({ error: 'No sign-up in progress for that email. Start sign up again.' });
    }

    const emailErr = validateEmail(email);
    if (emailErr) {
      return res.status(400).json({ error: emailErr });
    }

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      await SignupVerification.deleteOne({ email });
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }

    const now = new Date();
    const msSinceLastSend = now - new Date(pending.lastSentAt);
    if (msSinceLastSend < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - msSinceLastSend) / 1000);
      return res.status(429).json({ error: `Wait ${waitSec} seconds before requesting another code.` });
    }

    const code = generateVerificationCode();
    await SignupVerification.updateOne(
      { email },
      {
        $set: {
          codeHash: hashVerificationCode(code),
          attempts: 0,
          expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
          lastSentAt: now
        }
      }
    );

    const sent = await sendSignupVerificationEmail(pending.name, email, code);
    if (!sent) {
      return res.status(503).json({ error: 'Could not send the verification email. Try again in a moment.' });
    }

    res.json({
      ok: true,
      maskedEmail: maskEmail(email),
      expiresInMinutes: Math.round(VERIFICATION_CODE_TTL_MS / 60000)
    });
  } catch (err) {
    console.error('POST /api/auth/signup/resend failed:', err);
    res.status(500).json({ error: 'Could not resend the verification code.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (matchesAdminLogin(email, password)) {
      const token = createToken({ role: 'admin', email, name: 'Admin' });
      return res.json({ token, role: 'admin', name: 'Admin', email });
    }

    const user = await User.findOne({ email }).lean();
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = createToken({
      role: user.role || 'customer',
      userId: String(user._id),
      email: user.email,
      name: user.name
    });

    const shipping = await resolveUserShipping(user);

    res.json({
      token,
      role: user.role || 'customer',
      name: user.name,
      email: user.email,
      shipping
    });
  } catch (err) {
    console.error('POST /api/auth/login failed:', err);
    res.status(500).json({ error: 'Could not log you in.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const data = verifyToken(getBearerToken(req));
  if (!data) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  if (data.userId) {
    try {
      const user = await User.findById(data.userId).lean();
      if (user) {
        const shipping = await resolveUserShipping(user);
        return res.json({
          role: user.role || data.role,
          name: user.name,
          email: user.email,
          shipping
        });
      }
    } catch (err) {
      console.error('GET /api/auth/me lookup failed:', err);
    }
  }
  res.json({
    role: data.role,
    name: data.name,
    email: data.email,
    shipping: null
  });
});

app.patch('/api/auth/account', async (req, res) => {
  try {
    const data = verifyToken(getBearerToken(req));
    if (!data || data.role === 'admin') {
      return res.status(403).json({ error: 'Account changes are not available here.' });
    }
    if (!data.userId) {
      return res.status(401).json({ error: 'Not logged in.' });
    }

    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const currentPassword = req.body?.currentPassword != null ? String(req.body.currentPassword) : '';
    const newPassword = req.body?.newPassword != null ? String(req.body.newPassword) : '';
    const hasShippingUpdate = ['address', 'city', 'state', 'zip'].some((key) => req.body?.[key] != null);

    const updates = {};
    if (name != null) {
      const nameErr = validateSignupName(name);
      if (nameErr) {
        return res.status(400).json({ error: nameErr });
      }
      updates.name = name;
    }

    if (hasShippingUpdate) {
      const user = await User.findById(data.userId).lean();
      const shippingValidated = validateShippingFields({
        address: req.body?.address ?? user?.shipping?.address,
        city: req.body?.city ?? user?.shipping?.city,
        state: req.body?.state ?? user?.shipping?.state,
        zip: req.body?.zip ?? user?.shipping?.zip
      });
      if (shippingValidated.error) {
        return res.status(400).json({ error: shippingValidated.error });
      }
      updates.shipping = shippingValidated.shipping;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Enter your current password to set a new one.' });
      }
      const passwordErr = validatePasswordStrength(newPassword);
      if (passwordErr) {
        return res.status(400).json({ error: passwordErr });
      }

      const user = await User.findById(data.userId).lean();
      if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      updates.passwordHash = hashPassword(newPassword);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const savedUser = await User.findOneAndUpdate(
      { _id: data.userId },
      { $set: updates },
      { new: true }
    );

    if (!savedUser) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const token = createToken({
      role: savedUser.role || 'customer',
      userId: String(savedUser._id),
      email: savedUser.email,
      name: savedUser.name
    });

    res.json(buildAuthResponse(asPlain(savedUser), token));
  } catch (err) {
    console.error('PATCH /api/auth/account failed:', err);
    res.status(500).json({ error: 'Could not update your account.' });
  }
});

app.delete('/api/auth/account', async (req, res) => {
  try {
    const data = verifyToken(getBearerToken(req));
    if (!data || data.role === 'admin') {
      return res.status(403).json({ error: 'Account deletion is not available here.' });
    }
    if (!data.userId) {
      return res.status(401).json({ error: 'Not logged in.' });
    }

    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ error: 'Enter your password to delete your account.' });
    }

    const user = await User.findById(data.userId);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Password is incorrect.' });
    }

    await User.deleteOne({ _id: user._id });
    if (user.email) {
      await SignupVerification.deleteMany({ email: user.email });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/auth/account failed:', err);
    res.status(500).json({ error: 'Could not delete your account.' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  try {
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(orders.map(sanitizeAdminOrder));
  } catch (err) {
    console.error('GET /api/admin/orders failed:', err);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

app.patch('/api/admin/orders/:orderNumber', requireAdmin, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const allowed = ['awaiting_confirmation', 'pending', 'printing', 'shipped', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const order = await Order.findOneAndUpdate(
      { orderNumber },
      { $set: { status } },
      { new: true }
    ).lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    res.json(sanitizeAdminOrder(order));
  } catch (err) {
    console.error('PATCH /api/admin/orders/:orderNumber failed:', err);
    res.status(500).json({ error: 'Could not update order.' });
  }
});

app.post('/api/validate-email', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const err = validateEmail(email);
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/validate-email failed:', err);
    res.status(500).json({ error: 'Could not verify that email.' });
  }
});

app.post('/api/validate-address', (req, res) => {
  try {
    const city = String(req.body?.city || '').trim();
    const state = String(req.body?.state || '').trim().toUpperCase();
    const zip = String(req.body?.zip || '').trim();

    if (!city || !state) {
      return res.status(400).json({ error: 'City and state are required.' });
    }
    if (!zip) {
      const cityErr = validateCityInState(city, state);
      if (cityErr) return res.status(400).json({ error: cityErr });
      return res.json({ ok: true });
    }
    if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      return res.status(400).json({ error: 'Enter a valid 5-digit ZIP or ZIP+4.' });
    }
    const err = validateShippingAddress(city, state, zip);
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/validate-address failed:', err);
    res.status(500).json({ error: 'Could not verify that address.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
    await mongoose.connection.db.admin().command({ ping: 1 });
    const mail = await getMailStatus();
    res.json({ ok: true, database: 'connected', mail });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, subtotal, shipping, total } = req.body;

    const validated = validateCustomerFields(customer);
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    const emailErr = validateEmail(validated.customer.email);
    if (emailErr) {
      return res.status(400).json({ error: emailErr });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    for (const item of items) {
      if (!item.productId || !item.name || typeof item.price !== 'number' || typeof item.qty !== 'number') {
        return res.status(400).json({ error: 'Invalid cart item data.' });
      }
    }

    const orderNumber = generateOrderNumber();

    let savedItems;
    try {
      savedItems = await saveOrderItemImages(items, orderNumber);
    } catch (imgErr) {
      return res.status(400).json({ error: imgErr.message || 'Could not save order photos.' });
    }

    const order = await Order.create({
      orderNumber,
      status: 'awaiting_confirmation',
      emailConfirmed: false,
      confirmationToken: generateConfirmationToken(),
      customer: validated.customer,
      items: savedItems,
      subtotal: Number(subtotal),
      shipping: Number(shipping),
      total: Number(total)
    });

    const orderPlain = asPlain(order);
    const confirmationEmailSent = await sendOrderConfirmationEmail(orderPlain);

    res.status(201).json({
      ...sanitizeOrder(orderPlain),
      confirmationEmailSent
    });
  } catch (err) {
    console.error('POST /api/orders failed:', err);
    res.status(500).json({ error: 'Could not place your order. Please try again.' });
  }
});

app.post('/api/orders/confirm', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const orderNumber = String(req.body?.orderNumber || '').trim().toUpperCase();

    if (!token) {
      return res.status(400).json({ error: 'Confirmation link is required.' });
    }
    if (!orderNumber) {
      return res.status(400).json({ error: 'Please enter your order number.' });
    }
    if (!/^JYM-\d{6}$/.test(orderNumber)) {
      return res.status(400).json({ error: 'Enter a valid order number (e.g. JYM-482913).' });
    }

    const order = await Order.findOne({ confirmationToken: token }).lean();
    if (!order) {
      return res.status(404).json({ error: 'This confirmation link is invalid or has already been used.' });
    }

    if (order.orderNumber !== orderNumber) {
      return res.status(400).json({ error: 'That order number does not match. Check the number in your email and try again.' });
    }

    if (order.emailConfirmed) {
      return res.json({ ok: true, alreadyConfirmed: true, orderNumber: order.orderNumber });
    }

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          emailConfirmed: true,
          status: 'pending',
          confirmedAt: new Date()
        },
        $unset: { confirmationToken: '' }
      }
    );

    res.json({ ok: true, orderNumber: order.orderNumber });
  } catch (err) {
    console.error('POST /api/orders/confirm failed:', err);
    res.status(500).json({ error: 'Could not confirm your order.' });
  }
});

app.get('/api/orders/confirm/:token', (req, res) => {
  res.status(400).json({
    error: 'Enter your order number on the confirmation page to finish.',
    token: String(req.params.token || '').trim()
  });
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required.' });
    }

    const order = await Order.findOne({ orderNumber }).lean();
    if (!order) {
      return res.status(404).json({ error: 'No order found with that number.' });
    }

    res.json(sanitizeOrder(order));
  } catch (err) {
    console.error('GET /api/orders/:orderNumber failed:', err);
    res.status(500).json({ error: 'Could not look up that order.' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));

async function start() {
  await ensureUploadsDir();
  await connectDatabase(MONGODB_URI);

  const server = app.listen(PORT, () => {
    console.log(`Just Your Memories running at ${getSiteUrl()}`);
    if (!isAdminConfigured()) {
      console.warn('Admin login not configured — set ADMIN_PASSWORD (and optional ADMIN_EMAIL) in .env.');
    }
    if (!isMailConfigured()) {
      console.warn('SMTP not configured — confirmation emails will not be sent until SMTP_HOST, SMTP_USER, and SMTP_PASS are set.');
    } else {
      warmMailConnection().catch((err) => {
        console.warn('SMTP warmup failed — first email may be slower:', err.message);
      });
    }
  });

  Promise.all([
    Order.syncIndexes(),
    User.syncIndexes(),
    SignupVerification.syncIndexes()
  ]).catch((err) => {
    console.error('Index sync failed:', err.message);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other server first, then run npm start again.`);
      console.error('On Windows PowerShell: Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }');
      process.exit(1);
    }
    throw err;
  });

  process.on('SIGINT', async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
