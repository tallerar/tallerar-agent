const OpenAI = require('openai');
const shopify = require('./shopify');
const NodeCache = require('node-cache');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

SOBRE IMÁGENES Y STORIES:
Si cliente envía imagen o responde una story, identifica el producto y busca en catálogo. Di exactamente qué prenda es y si hay stock.

ACCIONES DISPONIBLES (incluye JSON al FINAL si necesitas):
Buscar: {"action":"search","q":"término"}
Ver todos: {"action":"all_products"}
Stock específico: {"action":"stock","productId":123,"size":"M"}
Crear link pago: {"action":"cart","items":[{"variantId":123,"qty":1}],"discount":5}
Escalar: {"action":"escalate","reason":"motivo"}
Buscar alternativa: {"action":"search","q":"término alternativo"}

REGLAS CLAVE:
- SOLO vendes ropa y accesorios de Taller AR. Nada más.
- Si no tienes un producto → busca alternativa en catálogo y ofrécela.
- Si cliente duda → ofrece 5% descuento para cerrar ("te hago un 5% adicional si lo tomamos ahora").
- Nunca inventes stock ni precios.
- Si no puedes resolver → escala a humana.
- Pedidos van como canal "Agente IA Grow" en Shopify.`;

async function processMessage({ userId, message, channel, userData = {}, imageUrl = null }) {
  const historyKey = `conv_${channel}_${userId}`;
  const history = conversationCache.get(historyKey) || [];
  const session = sessionCache.get(`session_${userId}`) || { cart: [], discount: false };

  // Construir mensaje del usuario (con imagen si aplica)
  let userContent = message;
  if (imageUrl) {
    userContent = [
      { type: 'text', text: message || 'El cliente envió esta imagen, identifica el producto y busca en catálogo' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ];
  }

  history.push({ role: 'user', content: userContent });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-14),
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
      const secondResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.slice(-12),
          { role: 'assistant', content: cleanMessage || '...' },
          { role: 'user', content: `[DATOS SHOPIFY EN TIEMPO REAL]: ${JSON.stringify(actionResult)}\n\nResponde naturalmente, corto, como asesora. Si hay productos incluye el link directo. Si creaste carrito incluye el link de pago. Sin JSON en tu respuesta.` },
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
    return { message: 'Tuve un problema. Te conecto con una asesora ahora.', needsHuman: true };
  }
}

async function executeAction(action, session, userId) {
  switch (action.action) {
    case 'search':
    case 'all_products': {
      const q = action.q || '';
      const products = q ? await shopify.searchProducts(q) : await shopify.getProducts({ limit: 8 });
      return {
        type: 'products',
        products: products.slice(0, 5).map(shopify.formatProductForAgent),
      };
    }
    case 'stock': {
      const products = await shopify.getProducts({ limit: 250 });
      const product = products.find(p => p.id === action.productId);
      if (!product) return { type: 'stock_error', msg: 'Producto no encontrado' };
      const availability = await shopify.checkVariantAvailability(product, action.size);
      return { type: 'stock', productTitle: product.title, variants: availability };
    }
    case 'cart': {
      const discountPct = action.discount || 0;
      const draft = await shopify.createDraftOrder({
        items: action.items,
        customerNote: 'Pedido vía Agente IA Grow - Instagram/WhatsApp',
        discountPercent: discountPct,
        source: 'Agente IA Grow',
      });
      if (draft) {
        session.lastDraft = draft;
        session.discount = discountPct > 0;
        return {
          type: 'cart_created',
          invoiceUrl: draft.invoiceUrl,
          total: '$' + parseInt(draft.totalPrice).toLocaleString('es-CL'),
          discount: discountPct,
        };
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
