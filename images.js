const fs = require('fs').promises;
const path = require('path');
const { getSiteUrl } = require('./config');

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'orders');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/i);
  if (!match) return null;

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large. Please use a photo under 5 MB.');
  }

  const mime = match[1].toLowerCase();
  let ext = 'jpg';
  if (mime.includes('png')) ext = 'png';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('gif')) ext = 'gif';

  return { buffer, ext };
}

async function saveOrderItemImage(source, orderNumber, itemIndex) {
  if (!source) return null;
  if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
    return source;
  }

  const parsed = parseDataUrl(source);
  if (!parsed) return null;

  const filename = `${orderNumber}-${itemIndex}.${parsed.ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(filepath, parsed.buffer);

  return `${getSiteUrl()}/uploads/orders/${filename}`;
}

async function saveOrderItemImages(items, orderNumber) {
  const saved = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const imageUrl = await saveOrderItemImage(item.image, orderNumber, i);
    saved.push({
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty: item.qty,
      imageUrl: imageUrl || null
    });
  }
  return saved;
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  saveOrderItemImages
};
