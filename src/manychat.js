// Webhook para ManyChat - recibe mensajes y devuelve respuesta del agente
const agent = require('./agent');
const schedule = require('./schedule');

async function processManyChatWebhook(body) {
  const { subscriber_id, last_input_text, channel, page_id } = body;

  if (!schedule.isAgentActive()) {
    return {
      version: 'v2',
      content: {
        messages: [{ type: 'text', text: schedule.getOfflineMessage() }],
        actions: [],
        quick_replies: []
      }
    };
  }

  const userId = subscriber_id || page_id;
  const ch = channel === 'instagram' ? 'instagram' : 'whatsapp';

  const result = await agent.processMessage({
    userId,
    message: last_input_text || '',
    channel: ch,
  });

  const messages = [{ type: 'text', text: result.message }];

  // Si necesita humano, agregar tag en ManyChat
  const actions = result.needsHuman
    ? [{ action: 'add_tag', tag_name: 'necesita_humano' }]
    : [];

  return {
    version: 'v2',
    content: { messages, actions, quick_replies: [] }
  };
}

module.exports = { processManyChatWebhook };
