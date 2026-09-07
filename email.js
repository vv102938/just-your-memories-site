const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { getSiteUrl } = require('./config');

function trimEnv(name) {
  const value = process.env[name];
  return value == null ? '' : String(value).trim();
}

function isResendConfigured() {
  return Boolean(trimEnv('RESEND_API_KEY'));
}

function isSmtpConfigured() {
  return Boolean(trimEnv('SMTP_HOST') && trimEnv('SMTP_USER') && trimEnv('SMTP_PASS'));
}

function isMailConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

function getMailFrom() {
  const configured = trimEnv('MAIL_FROM');
  if (configured) return configured;
  const smtpUser = trimEnv('SMTP_USER');
  if (smtpUser) return `"Just Your Memories" <${smtpUser}>`;
  return '"Just Your Memories" <justyourmemories@gmail.com>';
}

function getSmtpPort() {
  const port = Number(trimEnv('SMTP_PORT') || 587);
  return Number.isFinite(port) ? port : 587;
}

function logMailError(label, err) {
  console.error(`${label} failed:`, err.message);
  if (err.response) {
    console.error(`${label} SMTP response:`, err.response);
  }
  if (err.code) {
    console.error(`${label} error code:`, err.code);
  }
}

function buildSmtpTransport(port) {
  const user = trimEnv('SMTP_USER');
  const pass = trimEnv('SMTP_PASS');
  const host = trimEnv('SMTP_HOST');
  const timeouts = {
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 25_000
  };

  if (host === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      ...timeouts
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465 || trimEnv('SMTP_SECURE') === 'true',
    auth: { user, pass },
    ...timeouts
  });
}

async function sendViaSmtp(message, label) {
  if (!isSmtpConfigured()) return false;

  const ports = [...new Set([getSmtpPort(), 587, 465])];
  let lastError = null;

  for (const port of ports) {
    const transport = buildSmtpTransport(port);
    try {
      await transport.sendMail({
        from: getMailFrom(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
      transport.close();
      return true;
    } catch (err) {
      lastError = err;
      logMailError(`${label} (SMTP port ${port})`, err);
      transport.close();
    }
  }

  if (lastError) {
    logMailError(label, lastError);
  }
  return false;
}

async function sendViaResend(message, label) {
  if (!isResendConfigured()) return false;

  const resend = new Resend(trimEnv('RESEND_API_KEY'));
  const { error } = await resend.emails.send({
    from: getMailFrom(),
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text
  });

  if (error) {
    throw new Error(error.message || 'Resend rejected the email.');
  }

  return true;
}

async function deliverMail(message, label) {
  if (isResendConfigured()) {
    try {
      return await sendViaResend(message, label);
    } catch (err) {
      logMailError(`${label} (Resend)`, err);
      if (!isSmtpConfigured()) return false;
    }
  }

  return sendViaSmtp(message, label);
}

async function warmMailConnection() {
  if (isResendConfigured()) return true;
  if (!isSmtpConfigured()) return false;

  const transport = buildSmtpTransport(getSmtpPort());
  try {
    await transport.verify();
    return true;
  } finally {
    transport.close();
  }
}

async function getMailStatus() {
  if (!isMailConfigured()) {
    return { configured: false, ready: false, provider: null };
  }

  if (isResendConfigured()) {
    return {
      configured: true,
      ready: true,
      provider: 'resend',
      smtpFallback: isSmtpConfigured()
    };
  }

  try {
    await warmMailConnection();
    return { configured: true, ready: true, provider: 'smtp' };
  } catch (err) {
    logMailError('SMTP verify', err);
    return { configured: true, ready: false, provider: 'smtp', error: err.message };
  }
}

function buildConfirmationEmail(order, confirmUrl) {
  const itemLines = order.items
    .map(item => `${item.name} × ${item.qty} — $${(item.price * item.qty).toFixed(2)}`)
    .join('\n');

  const text = [
    `Hi ${order.customer.name},`,
    '',
    `Thanks for your order with Just Your Memories!`,
    '',
    `Order number: ${order.orderNumber}`,
    `Total: $${order.total.toFixed(2)}`,
    '',
    'Items:',
    itemLines,
    '',
    `Shipping to:`,
    `${order.customer.address}`,
    `${order.customer.city}, ${order.customer.state} ${order.customer.zip}`,
    '',
    `Please confirm your order:`,
    `1. Open this link: ${confirmUrl}`,
    `2. Enter your order number: ${order.orderNumber}`,
    '',
    `If you did not place this order, you can ignore this email.`,
    '',
    '— Just Your Memories'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Confirm your order ${escapeHtml(order.orderNumber)}</title>
</head>
<body style="margin:0;padding:24px;background:#FBF2E2;">
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#241A12;">
    <h1 style="font-family:Georgia,serif;color:#EF4F80;">Just Your Memories</h1>
    <p>Hi ${escapeHtml(order.customer.name)},</p>
    <p>Thanks for your order! Here is a summary:</p>
    <p style="font-family:monospace;font-size:18px;font-weight:bold;">${escapeHtml(order.orderNumber)}</p>
    <ul>${order.items.map(item => `<li>${escapeHtml(item.name)} × ${item.qty} — $${(item.price * item.qty).toFixed(2)}</li>`).join('')}</ul>
    <p><strong>Total:</strong> $${order.total.toFixed(2)}</p>
    <p><strong>Shipping to:</strong><br>
      ${escapeHtml(order.customer.address)}<br>
      ${escapeHtml(order.customer.city)}, ${escapeHtml(order.customer.state)} ${escapeHtml(order.customer.zip)}
    </p>
    <p style="margin:28px 0;">
      <a href="${confirmUrl}" style="display:inline-block;background:#EF4F80;color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:bold;">
        Confirm your order
      </a>
    </p>
    <p style="font-size:14px;color:#5C4E40;">On the next page, enter your order number <strong>${escapeHtml(order.orderNumber)}</strong> to finish confirming.</p>
    <p style="font-size:13px;color:#5C4E40;">Or copy this link into your browser:<br><a href="${confirmUrl}">${confirmUrl}</a></p>
    <p style="font-size:13px;color:#5C4E40;">If you did not place this order, you can ignore this email.</p>
  </div>
</body>
</html>`;

  return {
    to: order.customer.email,
    subject: `Confirm your order ${order.orderNumber}`,
    text,
    html
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendOrderConfirmationEmail(order) {
  if (!isMailConfigured()) {
    console.warn('Email not configured — set RESEND_API_KEY or SMTP settings to send confirmation emails.');
    return false;
  }

  const confirmUrl = `${getSiteUrl()}/confirm-order.html?token=${encodeURIComponent(order.confirmationToken)}`;
  const message = buildConfirmationEmail(order, confirmUrl);
  return deliverMail(message, `Order confirmation email (${order.orderNumber})`);
}

function buildSignupVerificationEmail(name, email, code) {
  const text = [
    `Hi ${name},`,
    '',
    'Thanks for signing up with Just Your Memories!',
    '',
    `Your verification code is: ${code}`,
    '',
    'Enter this code on the sign-up page to finish creating your account.',
    'The code expires in 15 minutes.',
    '',
    'If you did not try to sign up, you can ignore this email.',
    '',
    '— Just Your Memories'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verify your email</title>
</head>
<body style="margin:0;padding:24px;background:#FBF2E2;">
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#241A12;">
    <h1 style="font-family:Georgia,serif;color:#EF4F80;">Just Your Memories</h1>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Enter this code on the sign-up page to verify your email and finish creating your account:</p>
    <p style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:0.2em;margin:24px 0;">${escapeHtml(code)}</p>
    <p style="font-size:14px;color:#5C4E40;">This code expires in 15 minutes. If you did not try to sign up, you can ignore this email.</p>
  </div>
</body>
</html>`;

  return {
    to: email,
    subject: `${code} is your Just Your Memories verification code`,
    text,
    html
  };
}

async function sendSignupVerificationEmail(name, email, code) {
  if (!isMailConfigured()) {
    console.warn('Email not configured — cannot send signup verification emails.');
    return false;
  }

  const message = buildSignupVerificationEmail(name, email, code);
  return deliverMail(message, `Signup verification email (${email})`);
}

module.exports = {
  isMailConfigured,
  sendOrderConfirmationEmail,
  sendSignupVerificationEmail,
  warmMailConnection,
  getMailStatus,
  getSiteUrl
};
