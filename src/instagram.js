const axios = require('axios');
const agent = require('./agent');
const wa = require('./whatsapp');
const schedule = require('./schedule');

const IG_URL = 'https://graph.facebook.com/v18.0';

async function sendDM(recipientId, text) {
  try {
    await axios.post(
      `${IG_URL}/${process.env.INSTAGRAM_PAGE_ID}/messages`,
      { recipient: { id: recipientId }, message: { text }, messaging_type: 'RESPONSE' },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
  } catch (e) { console.error('IG DM error:', e.response?.data || e.message); }
}

async function replyToComment(commentId, message) {
  try {
    await axios.post(`${IG_URL}/${commentId}/replies`,
      { message },
      { params: { access_token: process.env.WHATSAPP_ACCESS_TOKEN } }
    );
  } catch (e) {}
}

async function processWebhook(body) {
  try {
    const entry = body.entry?.[0];

    // --- DMs ---
    if (entry?.messaging?.length > 0) {
      for (const event of entry.messaging) {
        if (!event.message || event.message.is_echo) continue;

        const senderId = event.sender.id;
        const text = event.message.text || '';
        let imageUrl = null;

        // Detectar imagen en DM
        if (event.message.attachments) {
          const imgAttachment = event.message.attachments.find(a => a.type === 'image');
          if (imgAttachment) imageUrl = imgAttachment.payload?.url;
        }

        // Detectar respuesta a story
        if (event.message.reply_to?.story) {
          imageUrl = event.message.reply_to.story.url;
        }

        // Verificar horario
        if (!schedule.isAgentActive()) {
          await sendDM(senderId, schedule.getOfflineMessage());
          return;
        }

        const result = await agent.processMessage({
          userId: senderId,
          message: text || (imageUrl ? 'El cliente envió una imagen' : ''),
          channel: 'instagram',
          userData: {},
          imageUrl,
        });

        await sendDM(senderId, result.message);

        if (result.needsHuman) {
          await wa.sendTicketToHuman({
            clientPhone: senderId,
            clientName: 'Usuario Instagram',
            reason: result.escalateReason,
            channel: 'Instagram DM',
          });
          await sendDM(senderId, 'Te conecto con una asesora ahora. ¡Te responden pronto! 🌸');
        }
      }
    }

    // --- Comentarios ---
    if (entry?.changes?.length > 0) {
      for (const change of entry.changes) {
        if (change.field !== 'comments') continue;

        const commentData = change.value;
        const commentText = commentData.text || '';
        const commentId = commentData.id;
        const commenterId = commentData.from?.id;

        const buyKeywords = ['precio', 'costo', 'talla', 'disponible', 'cuánto', 'cuanto', 'quiero', 'comprar', 'stock', 'info', 'tienen', 'hay', 'venden', 'dónde'];
        const hasBuyIntent = buyKeywords.some(kw => commentText.toLowerCase().includes(kw));

        if (hasBuyIntent && commentId) {
          await replyToComment(commentId, '¡Hola! Te escribimos por DM para ayudarte 🌸✨');

          if (commenterId && schedule.isAgentActive()) {
            const result = await agent.processMessage({
              userId: commenterId,
              message: `Vi tu comentario en el post: "${commentText}". ¿Te ayudo a encontrar lo que buscas?`,
              channel: 'instagram',
              userData: {},
            });
            await sendDM(commenterId, result.message);
          }
        }
      }
    }
  } catch (e) { console.error('IG webhook error:', e.message); }
}

function verifyWebhook(query) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return query['hub.challenge'];
  }
  return null;
}

module.exports = { processWebhook, verifyWebhook, sendDM };
