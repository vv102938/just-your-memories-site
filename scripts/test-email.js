require('dotenv').config();

const { getMailStatus, sendSignupVerificationEmail, isMailConfigured } = require('../email');

async function main() {
  if (!isMailConfigured()) {
    console.error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env or your host env vars.');
    process.exit(1);
  }

  const status = await getMailStatus();
  console.log('Mail status:', status);

  if (!status.ready) {
    console.error('SMTP connection failed. Check your app password and host settings.');
    process.exit(1);
  }

  const testTo = process.argv[2] || process.env.SMTP_USER;
  const sent = await sendSignupVerificationEmail('Test User', testTo, '123456');
  console.log(sent ? `Test email sent to ${testTo}` : 'Test email failed — see errors above.');
  process.exit(sent ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
