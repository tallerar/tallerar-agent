const OpenAI = require('openai');
const shopify = require('./shopify');
const NodeCache = require('node-cache');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const conversationCache = new NodeCache({ stdTTL: 1800 });
const sessionCache = new NodeCache({ stdTTL: 3600 });

const SYSTEM_PROMPT = `Eres la asesora de ventas de Taller AR, una boutique de moda femenina italiana con showroom en Rancagua, Chile. Te llamas "Andrea" y eres cálida, cercana y experta en moda.

PERSONALIDAD:
- Hablas en español chileno, de tú a tú, con un tono amigable y sofisticado
- Usas expresiones naturales: "qué buena elección", "te va a quedar hermoso", "es súper versátil"
- Eres empática y paciente, nunca presionas pero sí guías hacia la compra
- Si algo no está disponible, propones alternativas similares

GUÍA DE TALLAS:
- XS: talla 34-36, busto 80-84cm, cintura 60-64cm
- S: talla 38, busto 84-88cm, cintura 64-68cm
- M: talla 40-42, busto 88-94cm, cintura 68-74cm
- L: talla 44, busto 94-100cm, cintura 74-80cm
- XL: talla 46, busto 100-106cm, cintura 80-86cm

CUÁNDO ESCALAR A HUMANA:
- Si la clienta pide hablar con una persona
- Si hay problema con pedido anterior
- Si hay reclamo o situación compleja
- Si 3+ mensajes sin avanzar hacia compra

FORMATO:
- Mensajes cortos (máximo 4 líneas)
- Emojis con moderación (1-2 por mensaje)
- Para acciones, incluye JSON al FINAL del mensaje:
  Buscar: {"action":"search_products","query":"término"}
  Colección: {"action":"get_collection","name":"nombre"}
  Carrito: {"action":"create_cart","items":[{"variantId":123,"quantity":1}],"note":"nota"}
  Escalar: {"action":"escalate","reason":"motivo","summary":"resumen"}
  Stock: {"action":"check_stock","productId":123,"size":"M"}

SHOWROOM: Javiera Carrera 533, Rancagua. Despacho a todo Chile.`;

async function processMessage({ userId, message, channel, userData = {} }) {
  const historyKey = `conv_${channel}_${userId}`;
  const history = conversationCache.get(historyKey) || [];
  const session = sessionCache.get(`session_${userId}`) || { cart: [], preferences: {} };

  history.push({ role: 'user', content: message });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-12),
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    let assistantMessage = response.choices[0].message.content;
    const actionMatch = assistantMessage.match(/\{"action":"[^}]+"[^}]*\}/);
    let action = null;
    let cleanMessage = assistantMessage;

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[0]);
        cleanMessage = assistantMessage.replace(actionMatch[0], '').trim();
      } catch (e) {}
    }

    let actionResult = null;
    if (action) {
      actionResult = await executeAction(action, session, userId);
    }

    if (actionResult) {
      const secondResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.slice(-10),
          { role: 'assistant', content: cleanMessage || 'Un momento...' },
          { role: 'user', content: `[DATOS REALES DE SHOPIFY]: ${JSON.stringify(actionResult)}\n\nUsa estos datos para responder de forma natural y cálida. NO incluyas JSON en tu respuesta final.` },
        ],
        temperature: 0.7,
        max_tokens: 600,
      });
      assistantMessage = secondResponse.choices[0].message.content;
      assistantMessage = assistantMessage.replace(/\{"action":"[^}]+"[^}]*\}/g, '').trim();
    }

    history.push({ role: 'assistant', content: assistantMessage });
    conversationCache.set(historyKey, history);
    sessionCache.set(`session_${userId}`, session);

    return {
      message: assistantMessage,
      action: action ? action.action : null,
      actionData: actionResult,
      needsHuman: action && action.action === 'escalate',
      escalateReason: action ? action.reason : null,
      escalateSummary: action ? action.summary : null,
    };

  } catch (e) {
    console.error('Error en agente IA:', e.message);
    return {
      message: 'Tuve un pequeño problema. Puedo conectarte con una asesora ahora mismo.',
      needsHuman: true,
    };
  }
}

async function executeAction(action, session, userId) {
  switch (action.action) {
    case 'search_products': {
      const products = await shopify.searchProducts(action.query);
      return {
        type: 'products',
        found: products.length,
        products: products.slice(0, 4).map(shopify.formatProductForAgent),
      };
    }
    case 'get_collection': {
      const collections = await shopify.getCollections();
      const match = collections.find(c =>
        c.title.toLowerCase().includes(action.name.toLowerCase())
      );
      if (match) {
        const products = await shopify.getProductsByCollection(match.id);
        return {
          type: 'collection',
          collectionName: match.title,
          products: products.slice(0, 5).map(shopify.formatProductForAgent),
        };
      }
      const products = await shopify.searchProducts(action.name);
      return { type: 'products', products: products.slice(0, 5).map(shopify.formatProductForAgent) };
    }
    case 'check_stock': {
      const products = await shopify.getProducts({ limit: 250 });
      const product = products.find(p => p.id === action.productId);
      if (!product) return { type: 'stock', error: 'Producto no encontrado' };
      const availability = await shopify.checkVariantAvailability(product, action.size);
      return { type: 'stock', productTitle: product.title, variants: availability };
    }
    case 'create_cart': {
      const draft = await shopify.createDraftOrder({
        items: action.items,
        customerNote: action.note || 'Pedido desde chat - Taller AR',
      });
      if (draft) {
        session.lastDraftOrder = draft;
        return {
          type: 'cart_created',
          invoiceUrl: draft.invoiceUrl,
          total: '$' + parseInt(draft.totalPrice).toLocaleString('es-CL'),
          items: draft.lineItems ? draft.lineItems.length : action.items.length,
        };
      }
      return { type: 'cart_error', message: 'No se pudo crear el carrito' };
    }
    case 'escalate': {
      return { type: 'escalate', reason: action.reason, summary: action.summary };
    }
    default:
      return null;
  }
}

function clearConversation(userId, channel) {
  conversationCache.del(`conv_${channel}_${userId}`);
}

module.exports = { processMessage, clearConversation };
