const DEFAULT_SITE_URL = 'https://justyourmemories.company';

function getSiteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');
}

module.exports = {
  DEFAULT_SITE_URL,
  getSiteUrl,
  PORT: Number(process.env.PORT) || 3000
};
