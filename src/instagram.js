const axios = require('axios');
const agent = require('./agent');
const wa = require('./whatsapp');

const IG_API_URL = 'https://graph.facebook.com/v18.0';

// ─── ENVIAR MENSAJE DM ────────────────────────────────────────────────────────

async function sendDM(recipientId, text) {
  try {
    await axios.post(
      `${IG_API_URL}/${process.env.INSTAGRAM_PAGE_ID}/messages`,
      {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) {
    console.error('Error enviando IG DM:', e.response?.data || e.message);
  }
}

// ─── RESPONDER COMENTARIO ─────────────────────────────────────────────────────

async function replyToComment(commentId, message) {
  try {
    await axios.post(
      `${IG_API_URL}/${commentId}/replies`,
      { message },
      { params: { access_token: process.env.WHATSAPP_ACCESS_TOKEN } }
    );
  } catch (e) {
    console.error('Error respondiendo comentario IG:', e.message);
  }
}

// ─── PROCESAR WEBHOOK ─────────────────────────────────────────────────────────

async function processWebhook(body) {
  try {
    const entry = body.entry?.[0];
    const messaging = entry?.messaging;
    const changes = entry?.changes;

    // DM de Instagram
    if (messaging && messaging.length > 0) {
      for (const event of messaging) {
        if (!event.message || event.message.is_echo) continue;

        const senderId = event.sender.id;
        const text = event.message.text || '';
        if (!text) continue;

        console.log(`IG DM de ${senderId}: ${text}`);

        const result = await agent.processMessage({
          userId: senderId,
          message: text,
          channel: 'instagram',
          userData: {},
        });

        await sendDM(senderId, result.message);

        if (result.needsHuman) {
          await wa.sendTicketToHuman({
            clientPhone: senderId,
            clientName: 'Usuario de Instagram',
            reason: result.escalateReason,
            summary: result.escalateSummary,
            channel: 'Instagram DM',
          });
          await sendDM(senderId,
            'Te estoy conectando con una asesora. Te responderemos muy pronto. ¡Gracias! 🌸'
          );
        }
      }
    }

    // Comentarios en posts
    if (changes && changes.length > 0) {
      for (const change of changes) {
        if (change.field !== 'comments') continue;

        const commentData = change.value;
        const commentText = commentData.text || '';
        const commentId = commentData.id;
        const commenterId = commentData.from?.id;

        // Solo responder comentarios con keywords de compra
        const buyKeywords = ['precio', 'costo', 'talla', 'disponible', 'cuánto', 'cuanto', 'quiero', 'comprar', 'stock', 'info'];
        const hasBuyIntent = buyKeywords.some(kw => commentText.toLowerCase().includes(kw));

        if (hasBuyIntent && commentId) {
          await replyToComment(commentId,
            'Hola! Te escribimos por DM para ayudarte con más detalles 🌸✨'
          );

          // Iniciar conversación DM automáticamente si tenemos el ID
          if (commenterId) {
            const result = await agent.processMessage({
              userId: commenterId,
              message: `Vi tu comentario: "${commentText}". ¿En qué te puedo ayudar?`,
              channel: 'instagram',
              userData: {},
            });
            await sendDM(commenterId, result.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error procesando webhook IG:', e.message);
  }
}

function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

module.exports = { processWebhook, verifyWebhook, sendDM };
