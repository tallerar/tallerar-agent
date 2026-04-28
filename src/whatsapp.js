const axios = require('axios');
const agent = require('./agent');

const WA_API_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

// ─── ENVIAR MENSAJE ────────────────────────────────────────────────────────────

async function sendMessage(to, text) {
  try {
    await axios.post(WA_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) {
    console.error('Error enviando WA:', e.response?.data || e.message);
  }
}

async function sendTemplate(to, templateName, languageCode = 'es') {
  try {
    await axios.post(WA_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: languageCode } },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) {
    console.error('Error enviando template WA:', e.message);
  }
}

// ─── ENVIAR TICKET A ASESORA ──────────────────────────────────────────────────

async function sendTicketToHuman({ clientPhone, clientName, reason, summary, channel }) {
  const supportNumber = process.env.SUPPORT_WHATSAPP;
  if (!supportNumber) return;

  const ticketMsg = `🎫 *TICKET DE ATENCIÓN - TALLER AR*\n\n` +
    `📱 Canal: ${channel}\n` +
    `👤 Cliente: ${clientName || 'Sin nombre'}\n` +
    `📞 Teléfono: ${clientPhone || 'No disponible'}\n` +
    `❓ Motivo: ${reason || 'Solicitud de atención humana'}\n\n` +
    `📝 *Resumen de la conversación:*\n${summary || 'Sin resumen disponible'}\n\n` +
    `⏰ Hora: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;

  await sendMessage(supportNumber, ticketMsg);
}

// ─── PROCESAR WEBHOOK ─────────────────────────────────────────────────────────

async function processWebhook(body) {
  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return; // No hay mensajes

    for (const msg of value.messages) {
      const from = msg.from;
      const msgType = msg.type;

      // Solo procesar mensajes de texto por ahora
      if (msgType !== 'text') {
        await sendMessage(from, 'Hola 👋 Por el momento solo puedo leer mensajes de texto. ¿En qué te puedo ayudar?');
        continue;
      }

      const text = msg.text?.body || '';
      const contactName = value.contacts?.[0]?.profile?.name || 'Clienta';

      console.log(`WA mensaje de ${from} (${contactName}): ${text}`);

      // Marcar como leído
      await markAsRead(msg.id);

      // Procesar con el agente
      const result = await agent.processMessage({
        userId: from,
        message: text,
        channel: 'whatsapp',
        userData: { name: contactName, phone: from },
      });

      // Enviar respuesta
      await sendMessage(from, result.message);

      // Si necesita humano, crear ticket
      if (result.needsHuman) {
        await sendTicketToHuman({
          clientPhone: from,
          clientName: contactName,
          reason: result.escalateReason,
          summary: result.escalateSummary,
          channel: 'WhatsApp',
        });
        await sendMessage(from,
          'Te estoy conectando con una de nuestras asesoras ahora mismo. Te contactarán en breve. ¡Gracias por tu paciencia! 🌸'
        );
      }
    }
  } catch (e) {
    console.error('Error procesando webhook WA:', e.message);
  }
}

async function markAsRead(messageId) {
  try {
    await axios.post(WA_API_URL.replace('/messages', '/messages'),
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) {}
}

// ─── VERIFICACIÓN DE WEBHOOK ──────────────────────────────────────────────────

function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

module.exports = { processWebhook, verifyWebhook, sendMessage, sendTicketToHuman };
