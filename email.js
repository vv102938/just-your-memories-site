const nodemailer = require('nodemailer');
const { getSiteUrl } = require('./config');

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'justyourmemories@gmail.com';

let transporter;

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

function sendInBackground(task, label) {
  Promise.resolve()
    .then(task)
    .catch((err) => console.error(`${label} failed:`, err.message));
}

async function warmMailConnection() {
  const transport = getTransporter();
  if (!transport) return;
  await transport.verify();
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
    from: `"Just Your Memories" <${MAIL_FROM}>`,
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
  const transport = getTransporter();
  if (!transport) {
    console.warn('Email not configured — set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env to send confirmation emails.');
    return false;
  }

  const confirmUrl = `${getSiteUrl()}/confirm-order.html?token=${encodeURIComponent(order.confirmationToken)}`;
  const message = buildConfirmationEmail(order, confirmUrl);
  await transport.sendMail(message);
  return true;
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
    from: `"Just Your Memories" <${MAIL_FROM}>`,
    to: email,
    subject: `${code} is your Just Your Memories verification code`,
    text,
    html
  };
}

async function sendSignupVerificationEmail(name, email, code) {
  const transport = getTransporter();
  if (!transport) {
    console.warn('Email not configured — cannot send signup verification emails.');
    return false;
  }

  const message = buildSignupVerificationEmail(name, email, code);
  await transport.sendMail(message);
  return true;
}

function queueSignupVerificationEmail(name, email, code) {
  if (!isMailConfigured()) return false;
  sendInBackground(
    () => sendSignupVerificationEmail(name, email, code),
    'Signup verification email'
  );
  return true;
}

function queueOrderConfirmationEmail(order) {
  if (!isMailConfigured()) return false;
  sendInBackground(
    () => sendOrderConfirmationEmail(order),
    `Order confirmation email (${order.orderNumber})`
  );
  return true;
}

module.exports = {
  isMailConfigured,
  sendOrderConfirmationEmail,
  sendSignupVerificationEmail,
  queueOrderConfirmationEmail,
  queueSignupVerificationEmail,
  warmMailConnection,
  getSiteUrl
};
