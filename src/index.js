require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const whatsapp = require('./whatsapp');
const instagram = require('./instagram');
const manychat = require('./manychat');
const schedule = require('./schedule');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

function verifyMeta(req) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !process.env.META_APP_SECRET) return true;
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody).digest('hex');
  return sig === expected;
}

// Health check
app.get('/', (req, res) => res.json({
  status: 'online',
  service: 'Agente IA Grow - Taller AR',
  agentActive: schedule.isAgentActive(),
  timestamp: new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })
}));

// WhatsApp
app.get('/webhook/whatsapp', (req, res) => {
  const ch = whatsapp.verifyWebhook(req.query);
  if (ch) return res.status(200).send(ch);
  res.sendStatus(403);
});
app.post('/webhook/whatsapp', async (req, res) => {
  if (!verifyMeta(req)) return res.sendStatus(401);
  res.sendStatus(200);
  await whatsapp.processWebhook(req.body);
});

// Instagram
app.get('/webhook/instagram', (req, res) => {
  const ch = instagram.verifyWebhook(req.query);
  if (ch) return res.status(200).send(ch);
  res.sendStatus(403);
});
app.post('/webhook/instagram', async (req, res) => {
  if (!verifyMeta(req)) return res.sendStatus(401);
  res.sendStatus(200);
  await instagram.processWebhook(req.body);
});

// ManyChat webhook (para integración directa)
app.post('/webhook/manychat', async (req, res) => {
  try {
    const response = await manychat.processManyChatWebhook(req.body);
    res.json(response);
  } catch (e) {
    res.json({ version: 'v2', content: { messages: [{ type: 'text', text: 'Un momento, ya te ayudo.' }] } });
  }
});

// Shopify carrito abandonado
app.post('/webhook/shopify/abandoned', async (req, res) => {
  res.sendStatus(200);
  const checkout = req.body;
  const phone = checkout.phone;
  if (!phone || !schedule.isAgentActive()) return;

  const items = (checkout.line_items || []).map(i => i.title).join(', ');
  const wa = require('./whatsapp');
  setTimeout(async () => {
    await wa.sendMessage(phone, `Hola! Vi que dejaste ${items} en tu carrito 🛍️ ¿Te ayudo a completar tu compra? Puedo reservártelo ahora mismo.`);
  }, 2 * 60 * 60 * 1000); // 2 horas
});

// Test del agente
app.post('/api/test', async (req, res) => {
  const { message, userId = 'test', channel = 'instagram', imageUrl } = req.body;
  if (!message && !imageUrl) return res.status(400).json({ error: 'message required' });
  const agent = require('./agent');
  const result = await agent.processMessage({ userId, message: message || '', channel, imageUrl });
  res.json(result);
});

// Estado del horario
app.get('/api/schedule', (req, res) => {
  res.json({
    active: schedule.isAgentActive(),
    time: new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }),
  });
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🌸 Agente IA Grow - Taller AR - LIVE 🌸 ║
  ║  Puerto: ${PORT}                             ║
  ║  Agente activo: ${schedule.isAgentActive() ? 'SÍ ✅' : 'NO (equipo humano)'}          ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
