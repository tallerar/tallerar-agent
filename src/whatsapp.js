const axios = require('axios');
const agent = require('./agent');
const schedule = require('./schedule');

const WA_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

async function sendMessage(to, text) {
  try {
    await axios.post(WA_URL,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) { console.error('WA send error:', e.response?.data || e.message); }
}

async function sendTicketToHuman({ clientPhone, clientName, reason, channel }) {
  const support = process.env.SUPPORT_WHATSAPP;
  if (!support) return;
  const msg = `🎫 *TICKET - TALLER AR*\n📱 Canal: ${channel}\n👤 Cliente: ${clientName || 'Sin nombre'}\n📞 Tel: ${clientPhone || '-'}\n❓ Motivo: ${reason || 'Solicitud humana'}\n⏰ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;
  await sendMessage(support, msg);
}

async function processWebhook(body) {
  try {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages) return;

    for (const msg of value.messages) {
      const from = msg.from;
      const contactName = value.contacts?.[0]?.profile?.name || 'Cliente';

      await markAsRead(msg.id);

      // Verificar horario
      if (!schedule.isAgentActive()) {
        // Solo responder si es el primer mensaje (no spamear)
        const firstMsg = !require('node-cache') || true;
        if (firstMsg) await sendMessage(from, schedule.getOfflineMessage());
        return;
      }

      let text = '';
      let imageUrl = null;

      if (msg.type === 'text') {
        text = msg.text?.body || '';
      } else if (msg.type === 'image') {
        // Obtener URL de la imagen de WA
        const mediaId = msg.image?.id;
        if (mediaId) {
          try {
            const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`,
              { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
            );
            imageUrl = mediaRes.data.url;
          } catch (e) {}
        }
        text = msg.image?.caption || '';
      } else {
        await sendMessage(from, 'Por el momento proceso texto e imágenes. ¿En qué te puedo ayudar? 😊');
        return;
      }

      const result = await agent.processMessage({
        userId: from,
        message: text,
        channel: 'whatsapp',
        userData: { name: contactName, phone: from },
        imageUrl,
      });

      await sendMessage(from, result.message);

      if (result.needsHuman) {
        await sendTicketToHuman({ clientPhone: from, clientName: contactName, reason: result.escalateReason, channel: 'WhatsApp' });
        await sendMessage(from, 'Te conecto con una asesora ahora mismo. ¡Ya te contactan! 🌸');
      }
    }
  } catch (e) { console.error('WA webhook error:', e.message); }
}

async function markAsRead(messageId) {
  try {
    await axios.post(WA_URL,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) {}
}

function verifyWebhook(query) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return query['hub.challenge'];
  }
  return null;
}

module.exports = { processWebhook, verifyWebhook, sendMessage, sendTicketToHuman };
