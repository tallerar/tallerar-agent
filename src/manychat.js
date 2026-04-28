const agent = require('./agent');
const schedule = require('./schedule');

// Endpoint para el bloque "Contenido Dinámico" de ManyChat
// ManyChat espera respuesta en formato v2 con content.messages
async function processManyChatWebhook(body) {
  const subscriber_id = body.subscriber_id || body.id || 'unknown';
  const message = body.last_input_text || body.text || '';
  const channel = body.channel || 'instagram';
  const firstName = body.first_name || '';

  // Verificar horario
  if (!schedule.isAgentActive()) {
    return buildResponse(schedule.getOfflineMessage());
  }

  try {
    const result = await agent.processMessage({
      userId: subscriber_id,
      message: message,
      channel: channel,
      userData: { name: firstName },
    });

    const response = buildResponse(result.message);

    // Si necesita humano, agregar acción de tag
    if (result.needsHuman) {
      response.content.actions = [
        { action: 'add_tag', tag_name: 'necesita_humano' },
        { action: 'notify_admin', message: `Cliente ${subscriber_id} necesita atención humana: ${result.escalateReason}` }
      ];
    }

    return response;

  } catch (e) {
    console.error('ManyChat webhook error:', e.message);
    return buildResponse('Un momento, te conecto con una asesora 🌸');
  }
}

function buildResponse(text) {
  return {
    version: 'v2',
    content: {
      messages: [
        {
          type: 'text',
          text: text
        }
      ],
      actions: [],
      quick_replies: []
    }
  };
}

module.exports = { processManyChatWebhook };
