import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { openDatabase } from '../db.js';
import { cleanJersey, createStore, toPublicJersey } from '../store.js';
import { checkoutStatus, handleStripeEvent, parseWebhook, startCheckout } from '../checkout.js';

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

  test('jerseys keep their section, and orders record it for packing', async () => {
    const barca = (await store.listPublicJerseys()).find((j) => j.slug === 'barcelona');
    assert.equal(barca.section, 'women');
    assert.equal((await store.listPublicJerseys()).find((j) => j.slug === HENRY).section, 'men');
    assert.equal(cleanJersey({ team: 'X', priceUsd: 90, stock: { M: 1 } }).section, 'men');
    assert.equal(cleanJersey({ team: 'X', priceUsd: 90, stock: { M: 1 }, section: 'nonsense' }).section, 'men');
    assert.equal(toPublicJersey('old', { team: 'X', stock: {} }).section, 'men');
    const order = await store.createPendingOrder([{ slug: 'barcelona', size: 'L', qty: 1 }], SETTINGS);
    assert.equal(order.items[0].section, 'women');
  });

  test('sizes always come back in shirt order', async () => {
    const order = ['S', 'M', 'L', 'XL', 'XXL'];
    await store.createJersey({ team: 'Order Test', priceUsd: 90, stock: { XXL: 1, L: 1, S: 1, XL: 1, M: 1 } });
    const shop = (await store.listPublicJerseys()).find((j) => j.slug === 'order-test');
    const admin = (await store.listAllJerseys()).find((j) => j.slug === 'order-test');
    assert.deepEqual(Object.keys(shop.stock), order);
    assert.deepEqual(Object.keys(admin.stock), order);
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
    await store.markOrderAbandoned(one.id);
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

  test('stock is held at checkout and only taken once', async () => {
    const before_ = (await stockOf(HENRY)).L;
    const order = await place();
    assert.equal((await stockOf(HENRY)).L, before_ - 1);
    await pay(order);
    assert.equal((await stockOf(HENRY)).L, before_ - 1);
    const repeat = await pay(order);
    assert.equal(repeat.alreadyHandled, true);
    assert.equal((await stockOf(HENRY)).L, before_ - 1);
    const saved = await store.getOrder(order.id);
    assert.equal(saved.status, 'paid');
    assert.equal(saved.customer.name, 'Test Buyer');
  });

  test('takes stock for every size when a cart has two sizes of one jersey', async () => {
    const { M, L } = await stockOf(HENRY);
    await place([{ slug: HENRY, size: 'M', qty: 1 }, { slug: HENRY, size: 'L', qty: 1 }]);
    const after_ = await stockOf(HENRY);
    assert.deepEqual([after_.M, after_.L], [M - 1, L - 1]);
  });

  test('a second shopper cannot check out the last jersey while it is held', async () => {
    await place();
    await assert.rejects(place(), /Only 0 left/);
  });

  test('an abandoned checkout returns its stock exactly once', async () => {
    const start = (await stockOf(HENRY)).L;
    const order = await place();
    await store.markOrderAbandoned(order.id);
    await store.markOrderAbandoned(order.id);
    assert.equal((await stockOf(HENRY)).L, start);
    assert.equal((await store.getOrder(order.id)).stock_applied, false);
  });

  test('a late payment takes stock again after its hold was released', async () => {
    const start = (await stockOf(HENRY)).L;
    const order = await place();
    await store.markOrderAbandoned(order.id);
    await pay(order);
    assert.equal((await stockOf(HENRY)).L, start - 1);
    assert.equal((await store.getOrder(order.id)).stock_applied, true);
  });

  test('flags a late payment for review if the jersey has since sold', async () => {
    const first = await place();
    await store.markOrderAbandoned(first.id);
    const second = await place();
    await pay(second);
    const result = await pay(first);
    assert.equal(result.stockOk, false);
    const saved = await store.getOrder(first.id);
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

  const paidOrder = async () => {
    const order = await store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], SETTINGS);
    const event = completed(order);
    event.data.object.payment_intent = 'pi_1';
    await handleStripeEvent(store, event);
    return order;
  };
  const charge = (type, object) => handleStripeEvent(store, { type, data: { object: { payment_intent: 'pi_1', ...object } } });

  test('a failed delayed payment ends the order and returns its stock', async () => {
    const start = (await stockOf(HENRY)).L;
    const order = await store.createPendingOrder([{ slug: HENRY, size: 'L', qty: 1 }], SETTINGS);
    await handleStripeEvent(store, { type: 'checkout.session.async_payment_failed', data: { object: { client_reference_id: order.id } } });
    assert.equal((await store.getOrder(order.id)).status, 'abandoned');
    assert.equal((await stockOf(HENRY)).L, start);
  });

  test('a chargeback flags the order once and leaves its status and stock alone', async () => {
    const order = await paidOrder();
    const stock = (await stockOf(HENRY)).L;
    const dispute = { amount: 8800, reason: 'fraudulent' };
    await charge('charge.dispute.created', dispute);
    await charge('charge.dispute.created', dispute);
    const saved = await store.getOrder(order.id);
    assert.equal(saved.needs_review, true);
    assert.equal(saved.status, 'paid');
    assert.equal(saved.events.filter((e) => /chargeback/.test(e.message)).length, 1);
    assert.equal((await stockOf(HENRY)).L, stock);
  });

  test('a Stripe refund flags the order unless it is already marked refunded', async () => {
    const order = await paidOrder();
    await charge('charge.refunded', { amount_refunded: 1000 });
    assert.equal((await store.getOrder(order.id)).needs_review, true);
    await store.updateOrder(order.id, { needsReview: false, status: 'refunded' });
    await charge('charge.refunded', { amount_refunded: 8800 });
    const saved = await store.getOrder(order.id);
    assert.equal(saved.needs_review, false);
    assert.ok(saved.events.some((e) => /\$88\.00 refunded/.test(e.message)));
  });

  test('ignores refunds for payments that are not store orders', async () => {
    await charge('charge.refunded', { payment_intent: 'pi_unknown', amount_refunded: 1000 });
  });

  test('checkout expires after about 30 minutes, and a Stripe failure releases the stock', async () => {
    const start = (await stockOf(HENRY)).L;
    await store.saveSettings({ shippingUsd: 8, countries: ['US'] });
    let sent;
    const url = await startCheckout(store, [{ slug: HENRY, size: 'L', qty: 1 }], { checkout: { sessions: { create: async (args) => { sent = args; return { id: 'cs_ok', url: 'https://stripe.test/pay' }; } } } });
    assert.equal(url, 'https://stripe.test/pay');
    const minutes = (sent.expires_at - Date.now() / 1000) / 60;
    assert.ok(minutes > 30 && minutes <= 31);
    await store.markOrderAbandoned(sent.client_reference_id);
    const failing = { checkout: { sessions: { create: async () => { throw new Error('Stripe is down'); } } } };
    await assert.rejects(startCheckout(store, [{ slug: HENRY, size: 'L', qty: 1 }], failing), /Stripe is down/);
    assert.equal((await stockOf(HENRY)).L, start);
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
