require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment. Copy .env.example to .env and set your connection string.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

let db;
let ordersCollection;

function generateOrderNumber() {
  return 'JYM-' + Math.floor(100000 + Math.random() * 899999);
}

function sanitizeOrder(doc) {
  return {
    orderNumber: doc.orderNumber,
    status: doc.status,
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
      qty: item.qty
    })),
    subtotal: doc.subtotal,
    shipping: doc.shipping,
    total: doc.total,
    createdAt: doc.createdAt
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, subtotal, shipping, total } = req.body;

    if (!customer?.name || !customer?.email || !customer?.address || !customer?.city || !customer?.state || !customer?.zip) {
      return res.status(400).json({ error: 'Please fill in all shipping details.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    for (const item of items) {
      if (!item.productId || !item.name || typeof item.price !== 'number' || typeof item.qty !== 'number') {
        return res.status(400).json({ error: 'Invalid cart item data.' });
      }
    }

    const order = {
      orderNumber: generateOrderNumber(),
      status: 'pending',
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim().toLowerCase(),
        address: String(customer.address).trim(),
        city: String(customer.city).trim(),
        state: String(customer.state).trim(),
        zip: String(customer.zip).trim()
      },
      items: items.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        image: item.image || null
      })),
      subtotal: Number(subtotal),
      shipping: Number(shipping),
      total: Number(total),
      createdAt: new Date()
    };

    await ordersCollection.insertOne(order);
    res.status(201).json(sanitizeOrder(order));
  } catch (err) {
    console.error('POST /api/orders failed:', err);
    res.status(500).json({ error: 'Could not place your order. Please try again.' });
  }
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required.' });
    }

    const order = await ordersCollection.findOne({ orderNumber });
    if (!order) {
      return res.status(404).json({ error: 'No order found with that number.' });
    }

    res.json(sanitizeOrder(order));
  } catch (err) {
    console.error('GET /api/orders/:orderNumber failed:', err);
    res.status(500).json({ error: 'Could not look up that order.' });
  }
});

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();
  ordersCollection = db.collection('orders');
  await ordersCollection.createIndex({ orderNumber: 1 }, { unique: true });
  await ordersCollection.createIndex({ createdAt: -1 });
  await ordersCollection.createIndex({ 'customer.email': 1 });

  app.listen(PORT, () => {
    console.log(`Just Your Memories running at http://localhost:${PORT}`);
  });

  process.on('SIGINT', async () => {
    await client.close();
    process.exit(0);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
