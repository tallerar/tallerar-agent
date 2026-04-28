require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const whatsapp = require('./whatsapp');
const instagram = require('./instagram');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// Verificar firma de Meta
function verifyMetaSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !process.env.META_APP_SECRET) return true; // Skip en dev
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  return signature === expected;
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Agente IA Taller AR', timestamp: new Date().toISOString() });
});

// ─── WHATSAPP WEBHOOK ─────────────────────────────────────────────────────────

app.get('/webhook/whatsapp', (req, res) => {
  const challenge = whatsapp.verifyWebhook(req.query);
  if (challenge) {
    console.log('WhatsApp webhook verificado OK');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // Responder inmediatamente a Meta
  await whatsapp.processWebhook(req.body);
});

// ─── INSTAGRAM WEBHOOK ────────────────────────────────────────────────────────

app.get('/webhook/instagram', (req, res) => {
  const challenge = instagram.verifyWebhook(req.query);
  if (challenge) {
    console.log('Instagram webhook verificado OK');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook/instagram', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  await instagram.processWebhook(req.body);
});

// ─── SHOPIFY WEBHOOK (carrito abandonado) ─────────────────────────────────────

app.post('/webhook/shopify/abandoned-cart', async (req, res) => {
  res.sendStatus(200);
  const checkout = req.body;
  // Solo procesar si tiene teléfono (para WhatsApp)
  const phone = checkout.phone || checkout.billing_address?.phone;
  if (!phone) return;

  const agent = require('./agent');
  const wa = require('./whatsapp');

  const productNames = (checkout.line_items || []).map(i => i.title).join(', ');
  const total = checkout.total_price ? '$' + parseInt(checkout.total_price).toLocaleString('es-CL') : '';

  const result = await agent.processMessage({
    userId: phone,
    message: `[CARRITO ABANDONADO] La clienta dejó en su carrito: ${productNames}. Total: ${total}. Link de recuperación: ${checkout.abandoned_checkout_url}`,
    channel: 'whatsapp',
    userData: { name: checkout.billing_address?.first_name || 'Clienta' },
  });

  // Esperar 2 horas antes de enviar (en producción usar job queue)
  setTimeout(() => {
    wa.sendMessage(phone, result.message);
  }, 2 * 60 * 60 * 1000);
});

// ─── API INTERNA (para testing) ───────────────────────────────────────────────

app.post('/api/test-agent', async (req, res) => {
  const { message, userId = 'test-user', channel = 'whatsapp' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const agent = require('./agent');
  const result = await agent.processMessage({ userId, message, channel });
  res.json(result);
});

app.get('/api/products', async (req, res) => {
  const shopify = require('./shopify');
  const products = await shopify.getProducts({ limit: 10 });
  res.json({ count: products.length, products: products.map(shopify.formatProductForAgent) });
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🌸 Agente IA Taller AR - ONLINE 🌸  ║
  ║   Puerto: ${PORT}                        ║
  ║   WhatsApp: /webhook/whatsapp         ║
  ║   Instagram: /webhook/instagram       ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
