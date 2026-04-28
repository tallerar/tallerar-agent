# 🌸 Agente IA Taller AR

Agente de ventas inteligente que conecta WhatsApp + Instagram con el inventario real de Shopify.

## Qué hace

- Responde como asesora humana en WhatsApp e Instagram
- Consulta stock e inventario en tiempo real desde Shopify
- Recomienda tallas según medidas de la clienta
- Crea carritos listos para pagar (draft orders) y envía el link
- Escala a asesora humana cuando no puede resolver algo
- Recupera carritos abandonados vía WhatsApp

---

## Instalación

### 1. Requisitos
- Node.js 18+
- Cuenta Meta Business con WhatsApp Business API
- OpenAI API Key (GPT-4o)
- Shopify con token de acceso

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus credenciales reales
```

Variables clave en .env:
```
SHOPIFY_STORE=tallerar.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpss_...  (ya lo tienes)
OPENAI_API_KEY=sk-...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
INSTAGRAM_PAGE_ID=...
META_APP_SECRET=...
META_VERIFY_TOKEN=tallerar_webhook_2024
SUPPORT_WHATSAPP=56XXXXXXXXX  (WhatsApp del equipo para tickets)
```

### 3. Instalar y correr

```bash
npm install
npm start
```

### 4. Deploy recomendado

**Railway.app** (más fácil, ~$5 USD/mes):
1. Conecta tu repo GitHub
2. Sube las variables de entorno
3. Railway genera URL pública automáticamente

**O con Render.com** (gratis con limitaciones):
1. New Web Service → conectar repo
2. Build Command: `npm install`
3. Start Command: `npm start`

---

## Configurar Webhooks en Meta

### WhatsApp
1. Meta Business Suite → WhatsApp → Configuración
2. Webhook URL: `https://TU-DOMINIO/webhook/whatsapp`
3. Verify Token: `tallerar_webhook_2024`
4. Suscribir a: `messages`

### Instagram
1. Meta Business Suite → Instagram → Webhooks
2. Webhook URL: `https://TU-DOMINIO/webhook/instagram`
3. Verify Token: `tallerar_webhook_2024`
4. Suscribir a: `messages`, `comments`

---

## Endpoints

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | Health check |
| `GET /webhook/whatsapp` | Verificación Meta |
| `POST /webhook/whatsapp` | Mensajes WhatsApp |
| `GET /webhook/instagram` | Verificación Meta |
| `POST /webhook/instagram` | DMs y comentarios IG |
| `POST /webhook/shopify/abandoned-cart` | Carrito abandonado |
| `POST /api/test-agent` | Test del agente |
| `GET /api/products` | Ver productos desde Shopify |

### Test rápido del agente

```bash
curl -X POST http://localhost:3000/api/test-agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Hola, busco un blazer negro, ¿tienen stock?"}'
```

---

## Cómo funciona el flujo de venta

```
Cliente escribe "hola" en WhatsApp/Instagram
        ↓
Agente IA saluda y pregunta qué busca
        ↓
Cliente describe lo que quiere
        ↓
Agente consulta Shopify en tiempo real
        ↓
Agente recomienda 2-3 productos con precio y tallas disponibles
        ↓
Cliente elige → Agente confirma talla
        ↓
Agente crea Draft Order en Shopify
        ↓
Agente envía link de pago directo
        ↓
Cliente paga en tallerar.cl (checkout normal)
```

Si en algún punto el agente no puede resolver → crea ticket y notifica al equipo por WhatsApp.

---

## Costo mensual estimado

| Servicio | Costo |
|----------|-------|
| Railway (servidor) | ~$5 USD |
| OpenAI GPT-4o | ~$10-30 USD según volumen |
| WhatsApp Business API | Gratis primeras 1000 conv/mes |
| Instagram API | Gratis |
| **Total** | **~$15-35 USD/mes** |
