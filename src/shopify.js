const axios = require('axios');

const shopify = axios.create({
  baseURL: `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.SHOPIFY_API_VERSION}`,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json',
  },
});

// ─── PRODUCTOS ───────────────────────────────────────────────────────────────

async function getProducts({ query = '', collection = '', limit = 10 } = {}) {
  try {
    const params = { limit, status: 'active', fields: 'id,title,handle,body_html,variants,images,tags,product_type' };
    if (query) params.title = query;
    const res = await shopify.get('/products.json', { params });
    return res.data.products;
  } catch (e) {
    console.error('Error getProducts:', e.message);
    return [];
  }
}

async function getProductByHandle(handle) {
  try {
    const res = await shopify.get(`/products.json`, { params: { handle } });
    return res.data.products[0] || null;
  } catch (e) {
    return null;
  }
}

async function searchProducts(query) {
  try {
    const res = await shopify.get('/products.json', {
      params: { limit: 8, status: 'active', title: query, fields: 'id,title,variants,images,tags,product_type' }
    });
    return res.data.products;
  } catch (e) {
    return [];
  }
}

async function getCollections() {
  try {
    const res = await shopify.get('/custom_collections.json', { params: { limit: 20 } });
    return res.data.custom_collections;
  } catch (e) {
    return [];
  }
}

async function getProductsByCollection(collectionId) {
  try {
    const res = await shopify.get('/products.json', {
      params: { collection_id: collectionId, limit: 10, status: 'active', fields: 'id,title,variants,images,tags' }
    });
    return res.data.products;
  } catch (e) {
    return [];
  }
}

// ─── INVENTARIO ──────────────────────────────────────────────────────────────

async function getInventoryForVariant(inventoryItemId) {
  try {
    const res = await shopify.get('/inventory_levels.json', {
      params: { inventory_item_ids: inventoryItemId }
    });
    const levels = res.data.inventory_levels;
    return levels.reduce((sum, l) => sum + l.available, 0);
  } catch (e) {
    return null;
  }
}

async function checkVariantAvailability(product, sizeName) {
  const variants = product.variants || [];
  const results = [];

  for (const v of variants) {
    const matchesSize = !sizeName || v.title.toLowerCase().includes(sizeName.toLowerCase()) ||
      v.option1?.toLowerCase().includes(sizeName.toLowerCase()) ||
      v.option2?.toLowerCase().includes(sizeName.toLowerCase());

    if (matchesSize || !sizeName) {
      const stock = await getInventoryForVariant(v.inventory_item_id);
      results.push({
        variantId: v.id,
        title: v.title,
        price: v.price,
        available: v.available || stock > 0,
        stock: stock,
        sku: v.sku,
      });
    }
  }
  return results;
}

// ─── DRAFT ORDERS (CARRITO LISTO PARA PAGAR) ─────────────────────────────────

async function createDraftOrder({ items, customerNote = '', customerEmail = '', customerPhone = '' }) {
  try {
    const lineItems = items.map(item => ({
      variant_id: item.variantId,
      quantity: item.quantity || 1,
    }));

    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        note: customerNote || 'Pedido desde WhatsApp/Instagram - Taller AR',
        tags: 'whatsapp,agente-ia',
        use_customer_default_address: false,
      }
    };

    if (customerEmail) draftOrderData.draft_order.email = customerEmail;

    const res = await shopify.post('/draft_orders.json', draftOrderData);
    const draft = res.data.draft_order;

    return {
      id: draft.id,
      invoiceUrl: draft.invoice_url,
      totalPrice: draft.total_price,
      currency: draft.currency,
      lineItems: draft.line_items,
      status: draft.status,
    };
  } catch (e) {
    console.error('Error createDraftOrder:', e.response?.data || e.message);
    return null;
  }
}

async function sendDraftOrderInvoice(draftOrderId) {
  try {
    await shopify.post(`/draft_orders/${draftOrderId}/send_invoice.json`, {
      draft_order_invoice: { to: '', subject: 'Tu pedido de Taller AR', custom_message: '' }
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────

async function findOrCreateCustomer({ phone, email, name }) {
  try {
    // Buscar cliente existente por teléfono
    if (phone) {
      const res = await shopify.get('/customers/search.json', { params: { query: `phone:${phone}` } });
      if (res.data.customers.length > 0) return res.data.customers[0];
    }

    // Crear nuevo cliente
    const newCustomer = { customer: { phone, email, first_name: name || 'Cliente', tags: 'whatsapp' } };
    const res2 = await shopify.post('/customers.json', newCustomer);
    return res2.data.customer;
  } catch (e) {
    return null;
  }
}

async function getCustomerOrders(customerId) {
  try {
    const res = await shopify.get(`/customers/${customerId}/orders.json`, { params: { limit: 3 } });
    return res.data.orders;
  } catch (e) {
    return [];
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatProductForAgent(product) {
  const variants = product.variants || [];
  const images = product.images || [];
  const firstImage = images[0]?.src || null;
  const price = variants[0]?.price || '0';
  const compareAt = variants[0]?.compare_at_price;
  const availableSizes = variants.filter(v => v.available !== false).map(v => v.title);
  const allSizes = variants.map(v => v.title);

  return {
    id: product.id,
    title: product.title,
    type: product.product_type,
    price: `$${parseInt(price).toLocaleString('es-CL')}`,
    originalPrice: compareAt ? `$${parseInt(compareAt).toLocaleString('es-CL')}` : null,
    discount: compareAt ? Math.round((1 - price / compareAt) * 100) + '%' : null,
    availableSizes,
    allSizes,
    imageUrl: firstImage,
    url: `https://tallerar.cl/products/${product.handle}`,
    tags: product.tags,
    variants: variants.map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      available: v.available,
      inventoryItemId: v.inventory_item_id,
    }))
  };
}

module.exports = {
  getProducts,
  getProductByHandle,
  searchProducts,
  getCollections,
  getProductsByCollection,
  checkVariantAvailability,
  createDraftOrder,
  sendDraftOrderInvoice,
  findOrCreateCustomer,
  getCustomerOrders,
  formatProductForAgent,
};
