const axios = require('axios');

const shopify = axios.create({
  baseURL: `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.SHOPIFY_API_VERSION}`,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json',
  },
});

async function getProducts({ limit = 10 } = {}) {
  try {
    const res = await shopify.get('/products.json', {
      params: { limit, status: 'active', fields: 'id,title,handle,variants,images,tags,product_type' }
    });
    return res.data.products;
  } catch (e) { return []; }
}

async function searchProducts(query) {
  try {
    const res = await shopify.get('/products.json', {
      params: { limit: 10, status: 'active', title: query, fields: 'id,title,handle,variants,images,tags,product_type' }
    });
    return res.data.products;
  } catch (e) { return []; }
}

async function getCollections() {
  try {
    const res = await shopify.get('/custom_collections.json', { params: { limit: 20 } });
    return res.data.custom_collections;
  } catch (e) { return []; }
}

async function getProductsByCollection(collectionId) {
  try {
    const res = await shopify.get('/products.json', {
      params: { collection_id: collectionId, limit: 10, status: 'active' }
    });
    return res.data.products;
  } catch (e) { return []; }
}

async function checkVariantAvailability(product, sizeName) {
  const variants = product.variants || [];
  return variants
    .filter(v => !sizeName || v.title.toLowerCase().includes(sizeName.toLowerCase()))
    .map(v => ({
      variantId: v.id,
      title: v.title,
      price: v.price,
      available: v.available !== false,
      sku: v.sku,
    }));
}

async function createDraftOrder({ items, customerNote = '', discountPercent = 0, source = 'Agente IA Grow' }) {
  try {
    const lineItems = items.map(i => ({ variant_id: i.variantId, quantity: i.qty || 1 }));

    const draftData = {
      draft_order: {
        line_items: lineItems,
        note: customerNote,
        tags: 'agente-ia-grow,whatsapp-instagram',
        source_name: 'Agente IA Grow',
      }
    };

    // Aplicar descuento si corresponde
    if (discountPercent > 0) {
      draftData.draft_order.applied_discount = {
        description: `Descuento Agente IA ${discountPercent}%`,
        value_type: 'percentage',
        value: discountPercent.toString(),
        title: `Descuento ${discountPercent}%`,
      };
    }

    const res = await shopify.post('/draft_orders.json', draftData);
    const draft = res.data.draft_order;

    return {
      id: draft.id,
      invoiceUrl: draft.invoice_url,
      totalPrice: draft.total_price,
      currency: draft.currency,
    };
  } catch (e) {
    console.error('Error draft order:', e.response?.data || e.message);
    return null;
  }
}

async function createDiscountCode(percent = 5) {
  try {
    // Crear price rule
    const priceRule = await shopify.post('/price_rules.json', {
      price_rule: {
        title: `AGENTEIA${percent}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'percentage',
        value: `-${percent}`,
        customer_selection: 'all',
        starts_at: new Date().toISOString(),
      }
    });
    const ruleId = priceRule.data.price_rule.id;

    // Crear código único
    const code = `GROW${percent}-${Date.now().toString(36).toUpperCase()}`;
    await shopify.post(`/price_rules/${ruleId}/discount_codes.json`, {
      discount_code: { code }
    });

    return { code, percent };
  } catch (e) {
    console.error('Error discount:', e.message);
    return null;
  }
}

function formatProductForAgent(product) {
  const variants = product.variants || [];
  const firstImage = product.images?.[0]?.src || null;
  const price = variants[0]?.price || '0';
  const availableSizes = variants.filter(v => v.available !== false).map(v => v.title);

  return {
    id: product.id,
    title: product.title,
    type: product.product_type,
    price: '$' + parseInt(price).toLocaleString('es-CL'),
    availableSizes,
    imageUrl: firstImage,
    url: `https://tallerar.cl/products/${product.handle}`,
    variants: variants.map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      available: v.available !== false,
    }))
  };
}

module.exports = {
  getProducts,
  searchProducts,
  getCollections,
  getProductsByCollection,
  checkVariantAvailability,
  createDraftOrder,
  createDiscountCode,
  formatProductForAgent,
};
