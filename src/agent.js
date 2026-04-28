const Groq = require('groq-sdk');
const shopify = require('./shopify');
const NodeCache = require('node-cache');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const conversationCache = new NodeCache({ stdTTL: 1800 });
const sessionCache = new NodeCache({ stdTTL: 3600 });

const SYSTEM_PROMPT = `Eres Andrea, asesora de ventas de Taller AR. Boutique de moda femenina italiana, showroom en Rancagua, Chile.

PERSONALIDAD:
- Española chilena, de tú a tú. Cálida, cercana, experta en moda.
- Mensajes CORTOS: máximo 3 líneas. Sin redundancias. Sin saludos largos.
- Emojis: máximo 1-2 por mensaje, solo cuando suman.
- Nunca repitas lo que ya dijiste. Directo al punto.
- Eres hábil en ventas: si no hay stock de algo, SIEMPRE ofreces alternativa similar disponible.

PROCESO DE VENTA (siempre en este orden):
1. Entender qué busca (ocasión, estilo)
2. Preguntar talla y color preferido
3. Mostrar opciones con precio y link directo
4. Si no hay su talla/color → ofrecer alternativa + si duda mucho, ofrecer 5% descuento
5. Cerrar con link de pago listo

TALLAS:
XS=34-36 / S=38 / M=40-42 / L=44 / XL=46
- Entre tallas: holgado→talla mayor, ajustado→talla menor
- Preguntar siempre talla de jean para pantalones

COLECCIONES:
- OI 2026 italiana, Sastre (blazers/palazzo cotele: crudo/negro/marino/burdeo/taupe/tostado)
- Básicos, SALE FINAL -60%, Accesorios, Zapatos

PRECIOS ORIENTATIVOS:
Accesorios $6-40k / Blusas $40-50k / Pantalones $44-75k / Vestidos $50-59k / Blazers $48-130k / Abrigos $78-130k

SHOWROOM: Javiera Carrera 533, Rancagua. Despacho a todo Chile.

ACCIONES DISPONIBLES (incluye JSON al FINAL del mensaje si necesitas):
Buscar: {"action":"search","q":"término"}
Stock específico: {"action":"stock","productId":123,"size":"M"}
Crear carrito: {"action":"cart","items":[{"variantId":123,"qty":1}],"discount":0}
Escalar: {"action":"escalate","reason":"motivo"}

REGLAS CLAVE:
- SOLO vendes ropa y accesorios de Taller AR. Nada más.
- Si no tienes un producto → busca alternativa y ofrécela.
- Si cliente duda → ofrece 5% descuento para cerrar.
- Nunca inventes stock ni precios.
- Si no puedes resolver → escala a humana.`;

async function processMessage({ userId, message, channel, userData = {}, imageUrl = null }) {
  const historyKey = `conv_${channel}_${userId}`;
  const history = conversationCache.get(historyKey) || [];
  const session = sessionCache.get(`session_${userId}`) || {};

  history.push({ role: 'user', content: message || 'El cliente envió una imagen' });

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-12),
      ],
      temperature: 0.65,
      max_tokens: 500,
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
    if (action) actionResult = await executeAction(action, session, userId);

    if (actionResult) {
      const context = `[DATOS SHOPIFY]: ${JSON.stringify(actionResult)}\n\nResponde naturalmente, corto, como asesora. Incluye links de productos si los hay. Sin JSON en tu respuesta.`;
      
      const secondResponse = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.slice(-10),
          { role: 'assistant', content: cleanMessage || '...' },
          { role: 'user', content: context },
        ],
        temperature: 0.65,
        max_tokens: 500,
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
    };

  } catch (e) {
    console.error('Error agente:', e.message);
    return { message: 'Un momento, ya te ayudo 🌸', needsHuman: false };
  }
}

async function executeAction(action, session, userId) {
  switch (action.action) {
    case 'search': {
      const products = await shopify.searchProducts(action.q || '');
      return { type: 'products', products: products.slice(0, 4).map(shopify.formatProductForAgent) };
    }
    case 'stock': {
      const products = await shopify.getProducts({ limit: 250 });
      const product = products.find(p => p.id === action.productId);
      if (!product) return { type: 'stock_error' };
      const availability = await shopify.checkVariantAvailability(product, action.size);
      return { type: 'stock', productTitle: product.title, variants: availability };
    }
    case 'cart': {
      const draft = await shopify.createDraftOrder({
        items: action.items,
        customerNote: 'Pedido vía Agente IA Grow',
        discountPercent: action.discount || 0,
      });
      if (draft) {
        session.lastDraft = draft;
        return { type: 'cart_created', invoiceUrl: draft.invoiceUrl, total: '$' + parseInt(draft.totalPrice).toLocaleString('es-CL'), discount: action.discount };
      }
      return { type: 'cart_error' };
    }
    case 'escalate':
      return { type: 'escalate', reason: action.reason };
    default:
      return null;
  }
}

function clearConversation(userId, channel) {
  conversationCache.del(`conv_${channel}_${userId}`);
}

module.exports = { processMessage, clearConversation };
