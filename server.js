import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createStore, FREE_SHIPPING_MIN, NEXT_STATUS, ORDER_STATUSES, toPublicJersey, UserError } from './store.js';
import { adminConfigured, isSignedIn, login, logout, requireAdmin, sameOrigin } from './auth.js';
import { checkoutStatus, handleStripeEvent, parseWebhook, startCheckout } from './checkout.js';
import { confirmationEmail, emailStatus, sendOrderEmail, shippingEmail, shippingEmailDue } from './email.js';
import { handleShippoEvent, sendOrderToShippo, shippoStatus } from './shipping.js';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));
const indexFile = fileURLToPath(new URL('./public/index.html', import.meta.url));
const adminFile = fileURLToPath(new URL('./public/admin/index.html', import.meta.url));
const seedProducts = JSON.parse(readFileSync(new URL('./data/products.json', import.meta.url), 'utf8'));

const db = await openDatabase();
const store = db ? createStore(db) : null;
if (store && await store.seedJerseys(seedProducts)) console.log('Database started with the jerseys from data/products.json');
if (!store) console.warn('No DATABASE_URL: serving the catalog file, with admin and orders unavailable.');

const fileCatalog = seedProducts.map(({ slug, ...data }) => toPublicJersey(slug, data));
const IMAGE_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const needStore = (_req, res, next) => (store ? next() : res.status(503).json({ error: 'The database is not connected yet.' }));

app.get('/healthz', (_req, res) => res.send('ok'));

// Must read the untouched body to check Stripe's signature, so it comes before the JSON parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), wrap(async (req, res) => {
  if (!store) return res.status(503).end();
  let event;
  try {
    event = parseWebhook(req.body, req.headers['stripe-signature']);
  } catch {
    return res.status(400).send('Invalid signature');
  }
  await handleStripeEvent(store, event);
  return res.json({ received: true });
}));

// Shippo calls this when a label is bought or a package is delivered. It wants an answer
// within three seconds, so the work happens after replying.
app.post('/api/shippo/webhook', express.json({ limit: '1mb' }), (req, res) => {
  res.json({ received: true });
  if (!store || !shippoStatus().enabled) return;
  handleShippoEvent(store, req.body).catch((error) => console.error('Shippo webhook failed:', error));
});

// --- Public store ---
app.get('/api/products', wrap(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(store ? await store.listPublicJerseys() : fileCatalog);
}));

app.get('/api/config', wrap(async (_req, res) => {
  const settings = store ? await store.getSettings() : {};
  res.setHeader('Cache-Control', 'no-store');
  res.json({ checkoutEnabled: Boolean(store) && checkoutStatus(settings).enabled, freeShippingMin: FREE_SHIPPING_MIN });
}));

app.post('/api/checkout', express.json({ limit: '50kb' }), needStore, wrap(async (req, res) => {
  if (!checkoutStatus(await store.getSettings()).enabled) return res.status(503).json({ error: 'Online checkout is not open yet.' });
  res.json({ url: await startCheckout(store, req.body?.items, { lang: req.body?.lang }) });
}));

app.get('/media/:id', wrap(async (req, res) => {
  const file = store && /^[a-f0-9]{20}$/.test(req.params.id) ? await store.getMedia(req.params.id) : null;
  if (!file) return res.status(404).end();
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.end(Buffer.from(file.data));
}));

// --- Admin ---
const admin = express.Router();
admin.use(sameOrigin);
admin.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

admin.post('/login', express.json({ limit: '4kb' }), login);
admin.post('/logout', logout);
admin.get('/session', (req, res) => res.json({ signedIn: isSignedIn(req), configured: adminConfigured(), database: Boolean(store) }));

admin.use(requireAdmin, needStore);

admin.post('/media', express.raw({ type: 'image/*', limit: '8mb' }), wrap(async (req, res) => {
  const type = req.headers['content-type'];
  const signature = IMAGE_TYPES[type];
  const body = req.body;
  if (!signature || !Buffer.isBuffer(body) || !signature.every((byte, i) => body[i] === byte)) {
    throw new UserError('Upload a JPG, PNG or WebP image.');
  }
  res.json({ path: `/media/${await store.saveMedia(type, body)}` });
}));

admin.use(express.json({ limit: '200kb' }));

admin.get('/overview', wrap(async (_req, res) => {
  const settings = await store.getSettings();
  res.json({ counts: await store.orderCounts(), settings, checkout: checkoutStatus(settings), email: emailStatus(), shippo: shippoStatus(), statuses: ORDER_STATUSES, nextStatus: NEXT_STATUS });
}));

admin.get('/jerseys', wrap(async (_req, res) => res.json(await store.listAllJerseys())));
admin.post('/jerseys', wrap(async (req, res) => res.json({ slug: await store.createJersey(req.body) })));
admin.put('/jerseys/:slug', wrap(async (req, res) => {
  await store.updateJersey(req.params.slug, req.body);
  res.json({ ok: true });
}));
admin.post('/jerseys/:slug/move', wrap(async (req, res) => {
  await store.moveJersey(req.params.slug, req.body?.direction);
  res.json({ ok: true });
}));

admin.get('/orders', wrap(async (req, res) => res.json(await store.listOrders({ status: req.query.status }))));
admin.post('/orders', wrap(async (req, res) => {
  const created = await store.createManualOrder(req.body);
  await sendOrderToShippo(store, created.id);
  res.json(created);
}));
admin.post('/orders/:id/shippo', wrap(async (req, res) => {
  const result = await sendOrderToShippo(store, req.params.id, { force: true });
  res.json({ ...result, order: await store.getOrder(req.params.id) });
}));
admin.get('/orders/:id', wrap(async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) throw new UserError('Order not found.', 404);
  res.json(order);
}));
// Saving an order as shipped with a tracking number emails the customer, once per tracking number.
admin.patch('/orders/:id', wrap(async (req, res) => {
  const order = await store.updateOrder(req.params.id, req.body);
  if (!shippingEmailDue(order)) return res.json(order);
  await sendOrderEmail(store, order.id, 'shipping');
  return res.json(await store.getOrder(order.id));
}));
admin.post('/orders/:id/email', wrap(async (req, res) => {
  const kind = req.body?.kind;
  if (kind !== 'confirmation' && kind !== 'shipping') throw new UserError('Unknown email.');
  const result = await sendOrderEmail(store, req.params.id, kind, { force: true });
  res.json({ ...result, order: await store.getOrder(req.params.id) });
}));
// Shows an email exactly as the customer would get it, without sending anything.
admin.get('/orders/:id/email/:kind', wrap(async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) throw new UserError('Order not found.', 404);
  const build = { confirmation: confirmationEmail, shipping: shippingEmail }[req.params.kind];
  if (!build) throw new UserError('Unknown email.', 404);
  const lang = req.query.lang === 'es' || req.query.lang === 'en' ? req.query.lang : order.lang;
  res.type('html').send(build({ ...order, lang }).html);
}));

admin.put('/settings', wrap(async (req, res) => res.json(await store.saveSettings(req.body))));

app.use('/admin/api', admin);

app.use(express.static(publicDir, { index: false, redirect: false }));

// Pages are drawn in the browser, so each real page URL returns the same HTML shell.
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(adminFile);
});
app.get(/^\/(shop(\/[a-z0-9-]+)?|cart|archive|men|women|order\/complete)?\/?$/, (_req, res) => res.sendFile(indexFile));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((_req, res) => res.status(404).sendFile(indexFile));

// Friendly messages for expected problems; details of anything else stay in the server log.
app.use((error, _req, res, _next) => {
  if (error instanceof UserError) return res.status(error.status).json({ error: error.message });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large. The limit is 8 MB.' });
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Render provides PORT and requires listening on 0.0.0.0.
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`90archive running on port ${port}`));
