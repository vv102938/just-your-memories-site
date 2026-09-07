require('dotenv').config();

const { getMailStatus, sendSignupVerificationEmail, isMailConfigured } = require('../email');

async function main() {
  if (!isMailConfigured()) {
    console.error('Email is not configured. Set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.');
    process.exit(1);
  }

  const status = await getMailStatus();
  console.log('Mail status:', status);

  if (!status.ready) {
    console.error('Email provider is not ready.');
    if (status.error) console.error('Error:', status.error);
    process.exit(1);
  }

  const testTo = process.argv[2] || process.env.SMTP_USER || 'justyourmemories@gmail.com';
  const sent = await sendSignupVerificationEmail('Test User', testTo, '123456');
  console.log(sent ? `Test email sent to ${testTo}` : 'Test email failed — see errors above.');
  process.exit(sent ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
