import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { openDatabase } from '../db.js';
import { cleanJersey, createStore, toPublicJersey } from '../store.js';
import { checkoutStatus, handleStripeEvent, parseWebhook } from '../checkout.js';

const seed = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
const HENRY = 'arsenal-henry';
let db;
let store;

const stockOf = async (slug) => (await store.listAllJerseys()).find((j) => j.slug === slug).stock;
const customer = { name: 'Test Buyer', address: { line1: '1 Test St' } };
const SETTINGS = { shippingCents: 800, countries: ['US'] };

before(async () => {
  db = await openDatabase({ url: '', memory: true });
  store = createStore(db);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec('TRUNCATE jerseys, orders, media, settings RESTART IDENTITY');
  await store.seedJerseys(seed);
});

describe('catalog', () => {
  test('seeds once and keeps later edits', async () => {
    assert.equal((await store.listPublicJerseys()).length, seed.length);
    assert.equal(await store.seedJerseys(seed), false);
  });

  test('new jerseys get a unique address and appear without a chapter', async () => {
    const input = { team: 'Boca Juniors', player: 'Riquelme', number: 10, priceUsd: 90, discountUsd: 10, stock: { M: 2 } };
    assert.equal(await store.createJersey(input), 'boca-juniors-riquelme');
    assert.equal(await store.createJersey(input), 'boca-juniors-riquelme-2');
    const added = (await store.listPublicJerseys()).find((j) => j.slug === 'boca-juniors-riquelme');
    assert.equal(added.title, 'Boca Juniors');
    assert.equal(added.history, undefined);
  });

  test('hidden jerseys leave the shop and cannot be bought', async () => {
    const [jersey] = (await store.listAllJerseys()).filter((j) => j.slug === HENRY);
    await store.updateJersey(HENRY, { ...jersey, active: false });
    assert.ok(!(await store.listPublicJerseys()).some((j) => j.slug === HENRY));
    await assert.rejects(store.createPendingOrder([{ slug: HENRY, size: 'M', qty: 1 }], SETTINGS), /no longer available/);
  });

  test('rejects bad jersey details', () => {
    assert.throws(() => cleanJersey({ priceUsd: 90, stock: { M: 1 } }), /Team/);
    assert.throws(() => cleanJersey({ team: 'X', priceUsd: 0, stock: { M: 1 } }), /Price/);
    assert.throws(() => cleanJersey({ team: 'X', priceUsd: 90, discountUsd: 90, stock: { M: 1 } }), /Discount/);
    assert.throws(() => cleanJersey({ team: 'X', priceUsd: 90, stock: { M: -1 } }), /whole number/);
    assert.throws(() => cleanJersey({ team: 'X', priceUsd: 90, stock: {} }), /size/);
  });

  test('only allows images from this site, and links that are web addresses', () => {
    const out = cleanJersey({
      team: 'X', priceUsd: 90, stock: { M: 1 },
      images: ['/media/abc', 'javascript:alert(1)', 'https://evil.example/a.jpg', '/assets/../secret'],
      history: { years: '2000', sources: [{ label: 'Bad', url: 'javascript:alert(1)' }, { label: 'Good', url: 'https://example.com' }] },
    });
    assert.deepEqual(out.images, ['/media/abc']);
    assert.deepEqual(out.history.sources, [{ label: 'Good', url: 'https://example.com' }]);
  });

  test('Spanish falls back to English instead of showing blank', () => {
    const out = toPublicJersey('x', { team: 'X', history: { years: '2000', headline: { en: 'Hello', es: '' }, story: { en: ['Story'], es: [] }, moment: {}, stats: [] } });
    assert.equal(out.history.headline.es, 'Hello');
    assert.deepEqual(out.history.story.es, ['Story']);
  });

  test('every launch jersey keeps a chapter and a credited photo', async () => {
    for (const j of await store.listPublicJerseys()) {
      assert.ok(j.history.years, j.slug);
      assert.ok(j.history.photo.credit && j.history.photo.license && j.history.photo.page, j.slug);
    }
  });
});

describe('website orders', () => {
  const place = (lines = [{ slug: HENRY, size: 'L', qty: 1 }]) => store.createPendingOrder(lines, SETTINGS);
  const pay = (order, extra = {}) => store.markOrderPaid({ orderId: order.id, sessionId: `cs_${order.id}`, customer, totalCents: order.total, ...extra });

  test('uses database prices, charges shipping on one jersey and not on two', async () => {
    const one = await place();
    assert.deepEqual([one.subtotal, one.shipping, one.total], [8000, 800, 8800]);
    const two = await place([{ slug: HENRY, size: 'M', qty: 1 }, { slug: HENRY, size: 'L', qty: 1 }]);
    assert.deepEqual([two.subtotal, two.shipping, two.total], [16000, 0, 16000]);
  });

  test('ignores any price the browser sends', async () => {
    const order = await place([{ slug: HENRY, size: 'L', qty: 1, unitCents: 1, priceUsd: 1 }]);
    assert.equal(order.subtotal, 8000);
  });

  test('refuses more than is in stock, bad sizes and bad quantities', async () => {
    await assert.rejects(place([{ slug: HENRY, size: 'L', qty: 5 }]), /Only 1 left/);
    await assert.rejects(place([{ slug: HENRY, size: 'L', qty: 1 }, { slug: HENRY, size: 'L', qty: 1 }]), /Only 1 left/);
    await assert.rejects(place([{ slug: HENRY, size: 'XXS', qty: 1 }]), /does not come in/);
    for (const qty of [0, -1, 1.5, 'x']) await assert.rejects(place([{ slug: HENRY, size: 'L', qty }]), /not valid/);
    await assert.rejects(place([]), /no items/);
  });

  test('cannot start checkout before a shipping rate is set', async () => {
    await assert.rejects(store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], { shippingCents: null }), /Shipping/);
  });

  test('stock only drops once payment is confirmed, and only once', async () => {
    const before_ = (await stockOf(HENRY)).L;
    const order = await place();
    assert.equal((await stockOf(HENRY)).L, before_);
    await pay(order);
    assert.equal((await stockOf(HENRY)).L, before_ - 1);
    const repeat = await pay(order);
    assert.equal(repeat.alreadyHandled, true);
    assert.equal((await stockOf(HENRY)).L, before_ - 1);
    const saved = await store.getOrder(order.id);
    assert.equal(saved.status, 'paid');
    assert.equal(saved.customer.name, 'Test Buyer');
  });

  test('flags an order for review if the last jersey sold while someone was paying', async () => {
    const first = await place();
    const second = await place();
    await pay(first);
    const result = await pay(second);
    assert.equal(result.stockOk, false);
    const saved = await store.getOrder(second.id);
    assert.equal(saved.needs_review, true);
    assert.equal(saved.stock_applied, false);
    assert.equal((await stockOf(HENRY)).L, 0);
  });

  test('flags an order for review if the amount paid does not match', async () => {
    const order = await place();
    await pay(order, { totalCents: 100 });
    assert.equal((await store.getOrder(order.id)).needs_review, true);
  });

  test('unfinished checkouts stay out of the main order list', async () => {
    const order = await place();
    assert.equal((await store.listOrders()).length, 0);
    assert.equal((await store.listOrders({ status: 'pending' })).length, 1);
    await store.markOrderAbandoned(order.id);
    assert.equal((await store.getOrder(order.id)).status, 'abandoned');
  });
});

describe('processing orders', () => {
  const manual = (extra = {}) => store.createManualOrder({
    channel: 'Instagram', customer, shippingUsd: 5, items: [{ slug: HENRY, size: 'M', qty: 1 }], ...extra,
  });

  test('manual orders take stock and require a customer name', async () => {
    const { M } = await stockOf(HENRY);
    const { id, number } = await manual();
    assert.ok(number > 0);
    assert.equal((await stockOf(HENRY)).M, M - 1);
    const order = await store.getOrder(id);
    assert.equal(order.total_cents, 8500);
    assert.equal(order.status, 'paid');
    await assert.rejects(manual({ customer: {} }), /name/);
  });

  test('moves through packed, shipped and delivered with tracking', async () => {
    const { id } = await manual();
    await store.updateOrder(id, { status: 'packed' });
    await store.updateOrder(id, { status: 'shipped', carrier: 'USPS', tracking: '9400' });
    const done = await store.updateOrder(id, { status: 'delivered' });
    assert.equal(done.status, 'delivered');
    assert.equal(done.tracking, '9400');
    assert.ok(done.events.some((e) => /Tracking set/.test(e.message)));
  });

  test('blocks impossible status changes', async () => {
    const { id } = await manual();
    await assert.rejects(store.updateOrder(id, { status: 'delivered' }), /cannot go/);
    await store.updateOrder(id, { status: 'cancelled' });
    await assert.rejects(store.updateOrder(id, { status: 'paid' }), /cannot go/);
  });

  test('cancelling or refunding returns stock exactly once', async () => {
    const start = (await stockOf(HENRY)).M;
    const a = await manual();
    assert.equal((await stockOf(HENRY)).M, start - 1);
    await store.updateOrder(a.id, { status: 'cancelled' });
    assert.equal((await stockOf(HENRY)).M, start);
    await store.updateOrder(a.id, { status: 'cancelled' });
    assert.equal((await stockOf(HENRY)).M, start);

    const b = await manual();
    await store.updateOrder(b.id, { status: 'refunded' });
    assert.equal((await stockOf(HENRY)).M, start);
  });

  test('saving a note does not change the status', async () => {
    const { id } = await manual();
    const saved = await store.updateOrder(id, { note: 'Gift wrap' });
    assert.equal(saved.note, 'Gift wrap');
    assert.equal(saved.status, 'paid');
  });
});

describe('Stripe', () => {
  const SECRET = 'whsec_test_only';
  const stripe = new Stripe('sk_test_placeholder');
  const signed = (payload) => {
    const raw = JSON.stringify(payload);
    return [Buffer.from(raw), stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET })];
  };
  const completed = (order) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_1', client_reference_id: order.id, payment_status: 'paid', amount_total: order.total,
      customer_details: { email: 'buyer@example.com', name: 'Buyer' },
      collected_information: { shipping_details: { name: 'Buyer', address: { line1: '1 Main St', city: 'Raleigh', state: 'NC', postal_code: '27601', country: 'US' } } },
    } },
  });

  test('accepts a correctly signed payment and records the customer', async () => {
    const order = await store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], SETTINGS);
    const [raw, signature] = signed(completed(order));
    await handleStripeEvent(store, parseWebhook(raw, signature, stripe, SECRET));
    const saved = await store.getOrder(order.id);
    assert.equal(saved.status, 'paid');
    assert.equal(saved.customer.email, 'buyer@example.com');
    assert.equal(saved.customer.address.city, 'Raleigh');
  });

  test('rejects a forged or altered payment message', async () => {
    const order = await store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], SETTINGS);
    const [raw, signature] = signed(completed(order));
    assert.throws(() => parseWebhook(raw, 'bad-signature', stripe, SECRET));
    assert.throws(() => parseWebhook(Buffer.from(`${raw} `), signature, stripe, SECRET));
    assert.equal((await store.getOrder(order.id)).status, 'pending');
  });

  test('does not mark an unpaid session as paid', async () => {
    const order = await store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], SETTINGS);
    const event = completed(order);
    event.data.object.payment_status = 'unpaid';
    await handleStripeEvent(store, event);
    assert.equal((await store.getOrder(order.id)).status, 'pending');
  });

  test('checkout stays off until every setting is in place', () => {
    const saved = { ...process.env };
    try {
      delete process.env.CHECKOUT_ENABLED;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      assert.equal(checkoutStatus(SETTINGS).enabled, false);
      process.env.STRIPE_SECRET_KEY = 'sk_test_x';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
      assert.equal(checkoutStatus(SETTINGS).enabled, false, 'keys alone must not open checkout');
      process.env.CHECKOUT_ENABLED = 'true';
      assert.equal(checkoutStatus({ shippingCents: null }).enabled, false);
      const on = checkoutStatus(SETTINGS);
      assert.equal(on.enabled, true);
      assert.equal(on.mode, 'test');
    } finally {
      process.env = saved;
    }
  });
});
