// Jerseys, orders and settings. Every stock change happens inside a database transaction.
import { randomBytes, randomUUID } from 'node:crypto';

export const ORDER_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded', 'abandoned'];
const NEXT_STATUS = {
  pending: ['paid', 'cancelled'],
  paid: ['packed', 'shipped', 'cancelled', 'refunded'],
  packed: ['shipped', 'paid', 'cancelled', 'refunded'],
  shipped: ['delivered', 'packed', 'refunded'],
  delivered: ['shipped', 'refunded'],
  cancelled: [],
  refunded: [],
  abandoned: [],
};
const RESTOCK_STATUSES = new Set(['cancelled', 'refunded']);
export const FREE_SHIPPING_MIN = 2;
const MAX_QTY_PER_LINE = 20;

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

// The database does not keep sizes in the order they were saved, so put them back in shirt order.
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const sizeRank = (size) => {
  const rank = SIZE_ORDER.indexOf(size);
  return rank === -1 ? SIZE_ORDER.length : rank;
};
export const sortStock = (stock = {}) => Object.fromEntries(
  Object.entries(stock).sort(([a], [b]) => sizeRank(a) - sizeRank(b) || a.localeCompare(b)),
);
const text = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const pair = (value, max) => ({ en: text(value?.en, max), es: text(value?.es, max) });
const paragraphs = (value) => ({
  en: (Array.isArray(value?.en) ? value.en : []).map((x) => text(x)).filter(Boolean),
  es: (Array.isArray(value?.es) ? value.es : []).map((x) => text(x)).filter(Boolean),
});
const httpUrl = (value) => {
  const url = text(value, 1000);
  return /^https?:\/\//i.test(url) ? url : '';
};
const sitePath = (value) => {
  const path = text(value, 500);
  return /^\/(assets|media)\/[\w./-]+$/.test(path) && !path.includes('..') ? path : '';
};

export const slugify = (value) => text(value, 80)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Accepts what the editor sends and keeps only known fields in a known shape.
export function cleanJersey(input) {
  const team = text(input?.team, 120);
  if (!team) throw new UserError('Team is required.');
  const priceUsd = Number(input?.priceUsd);
  const discountUsd = Number(input?.discountUsd ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new UserError('Price must be above 0.');
  if (!Number.isFinite(discountUsd) || discountUsd < 0 || discountUsd >= priceUsd) {
    throw new UserError('Discount must be 0 or more, and less than the price.');
  }
  const stock = {};
  for (const [size, qty] of Object.entries(input?.stock ?? {})) {
    const name = text(size, 12).toUpperCase();
    const count = Number(qty);
    if (!name) continue;
    if (!Number.isInteger(count) || count < 0) throw new UserError(`Stock for ${name} must be a whole number.`);
    stock[name] = count;
  }
  if (!Object.keys(stock).length) throw new UserError('Add at least one size.');
  const number = input?.number === '' || input?.number == null ? null : Number(input.number);
  if (number !== null && (!Number.isInteger(number) || number < 0 || number > 999)) throw new UserError('Number must be a whole number.');

  const notes = {
    en: (input?.notes?.en ?? []).map((x) => text(x, 120)).filter(Boolean),
    es: (input?.notes?.es ?? []).map((x) => text(x, 120)).filter(Boolean),
  };
  const jersey = {
    section: input?.section === 'women' ? 'women' : 'men',
    title: text(input?.title, 120) || team,
    team,
    player: text(input?.player, 120) || null,
    number,
    priceUsd: Math.round(priceUsd * 100) / 100,
    discountUsd: Math.round(discountUsd * 100) / 100,
    stock,
    notes,
    images: (input?.images ?? []).map(sitePath).filter(Boolean),
  };

  const h = input?.history;
  const hasStory = h && (text(h.years) || text(h.story?.en?.[0]) || text(h.story?.es?.[0]));
  if (hasStory) {
    jersey.history = {
      years: text(h.years, 40),
      headline: pair(h.headline, 200),
      story: paragraphs(h.story),
      moment: {
        date: pair(h.moment?.date, 120),
        title: pair(h.moment?.title, 120),
        text: pair(h.moment?.text, 1000),
        query: text(h.moment?.query, 200),
      },
      stats: (h.stats ?? [])
        .map((s) => ({ value: text(s?.value, 20), label: pair(s?.label, 80) }))
        .filter((s) => s.value),
      photo: null,
      sources: (h.sources ?? [])
        .map((s) => ({ label: text(s?.label, 120), url: httpUrl(s?.url) }))
        .filter((s) => s.label && s.url),
    };
    const photo = h.photo;
    if (photo && sitePath(photo.src)) {
      jersey.history.photo = {
        src: sitePath(photo.src),
        w: Number(photo.w) || 1000,
        h: Number(photo.h) || 1000,
        alt: pair(photo.alt, 300),
        caption: pair(photo.caption, 300),
        credit: text(photo.credit, 120),
        license: text(photo.license, 60),
        licenseUrl: httpUrl(photo.licenseUrl) || null,
        page: httpUrl(photo.page),
      };
    }
  }
  return jersey;
}

// Shoppers see English wherever Spanish has not been written yet, rather than a blank.
const fill = (value) => (value ? { en: value.en, es: value.es?.length ? value.es : value.en } : value);
export function toPublicJersey(slug, data) {
  const out = { ...data, slug, section: data.section || 'men', stock: sortStock(data.stock), notes: fill(data.notes ?? { en: [], es: [] }), images: data.images ?? [], title: data.title || data.team };
  const h = data.history;
  if (h) {
    out.history = {
      ...h,
      headline: fill(h.headline),
      story: fill(h.story),
      moment: { ...h.moment, date: fill(h.moment?.date), title: fill(h.moment?.title), text: fill(h.moment?.text) },
      stats: (h.stats ?? []).map((s) => ({ ...s, label: fill(s.label) })),
      sources: h.sources ?? [],
      photo: h.photo ? { ...h.photo, alt: fill(h.photo.alt), caption: fill(h.photo.caption) } : null,
    };
  }
  return out;
}

const finalCents = (jersey) => Math.round((jersey.priceUsd - (jersey.discountUsd ?? 0)) * 100);
const shortId = () => randomBytes(10).toString('hex');
const event = (message) => ({ at: new Date().toISOString(), message });
const language = (value) => (value === 'es' ? 'es' : 'en');

function orderRow(row) {
  return {
    ...row,
    customer: parseJson(row.customer),
    items: parseJson(row.items),
    events: parseJson(row.events),
    emails: parseJson(row.emails ?? {}),
  };
}

export function createStore(db) {
  // --- Jerseys ---
  async function seedJerseys(products) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM jerseys');
    if (rows[0].n > 0) return false;
    await db.tx(async (q) => {
      for (const [position, p] of products.entries()) {
        const { slug, ...data } = p;
        await q('INSERT INTO jerseys (slug, position, data) VALUES ($1, $2, $3::jsonb)', [slug, position, JSON.stringify(data)]);
      }
    });
    return true;
  }

  async function listPublicJerseys() {
    const { rows } = await db.query('SELECT slug, data FROM jerseys WHERE active ORDER BY position, slug');
    return rows.map((r) => toPublicJersey(r.slug, parseJson(r.data)));
  }

  async function listAllJerseys() {
    const { rows } = await db.query('SELECT slug, position, active, data, updated_at FROM jerseys ORDER BY position, slug');
    return rows.map((r) => {
      const data = parseJson(r.data);
      return { slug: r.slug, position: r.position, active: r.active, updatedAt: r.updated_at, ...data, section: data.section || 'men', stock: sortStock(data.stock) };
    });
  }

  async function createJersey(input) {
    const data = cleanJersey(input);
    const base = slugify(input?.slug) || slugify([data.team, data.player].filter(Boolean).join(' ')) || 'jersey';
    return db.tx(async (q) => {
      let slug = base;
      for (let n = 2; (await q('SELECT 1 FROM jerseys WHERE slug = $1', [slug])).rows.length; n += 1) slug = `${base}-${n}`;
      const { rows } = await q('SELECT coalesce(max(position), -1) + 1 AS next FROM jerseys');
      await q('INSERT INTO jerseys (slug, position, active, data) VALUES ($1, $2, $3, $4::jsonb)', [slug, rows[0].next, input?.active !== false, JSON.stringify(data)]);
      return slug;
    });
  }

  async function updateJersey(slug, input) {
    const data = cleanJersey(input);
    const { rows } = await db.query('UPDATE jerseys SET data = $2::jsonb, active = $3, updated_at = now() WHERE slug = $1 RETURNING slug', [slug, JSON.stringify(data), input?.active !== false]);
    if (!rows.length) throw new UserError('Jersey not found.', 404);
  }

  async function moveJersey(slug, direction) {
    await db.tx(async (q) => {
      const { rows } = await q('SELECT slug FROM jerseys ORDER BY position, slug');
      const order = rows.map((r) => r.slug);
      const from = order.indexOf(slug);
      const to = from + (direction === 'up' ? -1 : 1);
      if (from < 0) throw new UserError('Jersey not found.', 404);
      if (to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to], order[from]];
      for (const [position, s] of order.entries()) await q('UPDATE jerseys SET position = $2 WHERE slug = $1', [s, position]);
    });
  }

  // --- Media ---
  async function saveMedia(mime, buffer) {
    const id = shortId();
    await db.query('INSERT INTO media (id, mime, data) VALUES ($1, $2, $3)', [id, mime, buffer]);
    return id;
  }

  async function getMedia(id) {
    const { rows } = await db.query('SELECT mime, data FROM media WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  // --- Settings ---
  const DEFAULT_SETTINGS = { shippingCents: null, countries: ['US'] };

  async function getSettings() {
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'store'");
    return { ...DEFAULT_SETTINGS, ...(rows[0] ? parseJson(rows[0].value) : {}) };
  }

  async function saveSettings(input) {
    const raw = input?.shippingUsd;
    let shippingCents = null;
    if (raw !== '' && raw != null) {
      const usd = Number(raw);
      if (!Number.isFinite(usd) || usd < 0) throw new UserError('Shipping must be 0 or more.');
      shippingCents = Math.round(usd * 100);
    }
    const countries = [...new Set((input?.countries ?? []).map((c) => text(c, 2).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
    if (!countries.length) throw new UserError('Add at least one shipping country, such as US.');
    const value = { shippingCents, countries };
    await db.query("INSERT INTO settings (key, value) VALUES ('store', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(value)]);
    return value;
  }

  // --- Orders ---
  // Prices and availability always come from the database, never from the browser.
  async function priceCart(q, lines) {
    if (!Array.isArray(lines) || !lines.length) throw new UserError('The order has no items.');
    const merged = new Map();
    for (const line of lines) {
      const slug = text(line?.slug, 120);
      const size = text(line?.size, 12).toUpperCase();
      const qty = Number(line?.qty);
      if (!slug || !size || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) throw new UserError('An item in the order is not valid.');
      const key = `${slug}|${size}`;
      merged.set(key, { slug, size, qty: (merged.get(key)?.qty ?? 0) + qty });
    }
    const items = [];
    for (const { slug, size, qty } of merged.values()) {
      const { rows } = await q('SELECT data, active FROM jerseys WHERE slug = $1', [slug]);
      if (!rows.length || !rows[0].active) throw new UserError('An item in the order is no longer available.', 409);
      const data = parseJson(rows[0].data);
      if (!(size in (data.stock ?? {}))) throw new UserError(`${data.title || data.team} does not come in ${size}.`);
      if (data.stock[size] < qty) throw new UserError(`Only ${data.stock[size]} left of ${data.title || data.team} in ${size}.`, 409);
      items.push({ slug, size, qty, section: data.section || 'men', title: data.title || data.team, team: data.team, player: data.player ?? null, number: data.number ?? null, unitCents: finalCents(data), image: data.images?.[0] ?? null });
    }
    const subtotal = items.reduce((sum, i) => sum + i.unitCents * i.qty, 0);
    const units = items.reduce((sum, i) => sum + i.qty, 0);
    return { items, subtotal, units };
  }

  // Removes stock for an order. Returns false, changing nothing, if any size has run out.
  async function takeStock(q, items) {
    const planned = new Map();
    // Locking jerseys in a fixed order stops two checkouts from waiting on each other.
    for (const item of [...items].sort((a, b) => a.slug.localeCompare(b.slug))) {
      if (!planned.has(item.slug)) {
        const { rows } = await q('SELECT data FROM jerseys WHERE slug = $1 FOR UPDATE', [item.slug]);
        planned.set(item.slug, rows.length ? parseJson(rows[0].data) : null);
      }
      const data = planned.get(item.slug);
      if (!data || (data.stock?.[item.size] ?? 0) < item.qty) return false;
      data.stock[item.size] -= item.qty;
    }
    for (const [slug, data] of planned) {
      await q('UPDATE jerseys SET data = $2::jsonb, updated_at = now() WHERE slug = $1', [slug, JSON.stringify(data)]);
    }
    return true;
  }

  async function returnStock(q, items) {
    for (const item of items) {
      const { rows } = await q('SELECT data FROM jerseys WHERE slug = $1 FOR UPDATE', [item.slug]);
      if (!rows.length) continue;
      const data = parseJson(rows[0].data);
      data.stock[item.size] = (data.stock[item.size] ?? 0) + item.qty;
      await q('UPDATE jerseys SET data = $2::jsonb, updated_at = now() WHERE slug = $1', [item.slug, JSON.stringify(data)]);
    }
  }

  // Saved before payment. Holds the stock so two people can't pay for the last jersey.
  async function createPendingOrder(lines, settings, lang = 'en') {
    return db.tx(async (q) => {
      const { items, subtotal, units } = await priceCart(q, lines);
      if (settings.shippingCents == null) throw new UserError('Shipping is not set up yet.', 503);
      if (!(await takeStock(q, items))) throw new UserError('One of those sizes just sold out.', 409);
      const shipping = units >= FREE_SHIPPING_MIN ? 0 : settings.shippingCents;
      const id = randomUUID();
      await q(`INSERT INTO orders (id, status, channel, items, subtotal_cents, shipping_cents, total_cents, stock_applied, events, lang)
               VALUES ($1, 'pending', 'website', $2::jsonb, $3, $4, $5, true, $6::jsonb, $7)`,
      [id, JSON.stringify(items), subtotal, shipping, subtotal + shipping, JSON.stringify([event('Customer started checkout, stock held')]), language(lang)]);
      return { id, items, subtotal, shipping, total: subtotal + shipping };
    });
  }

  async function attachCheckoutSession(orderId, sessionId) {
    await db.query('UPDATE orders SET stripe_session = $2 WHERE id = $1', [orderId, sessionId]);
  }

  // Safe to call repeatedly, because Stripe can deliver the same event more than once.
  async function markOrderPaid({ orderId, sessionId, paymentIntent = null, customer, totalCents }) {
    return db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!rows.length) return { found: false };
      const order = orderRow(rows[0]);
      if (order.status !== 'pending' && order.status !== 'abandoned') return { found: true, alreadyHandled: true };
      // A late payment on an expired checkout has had its hold released, so it needs stock again.
      const stockOk = order.stock_applied || await takeStock(q, order.items);
      const amountOk = totalCents == null || totalCents === order.total_cents;
      const needsReview = !stockOk || !amountOk;
      const events = [...order.events, event('Payment confirmed by Stripe')];
      if (!stockOk) events.push(event('Stock ran out before payment finished. Refund or source this item.'));
      if (!amountOk) events.push(event(`Stripe charged ${totalCents} cents, but the order total is ${order.total_cents} cents.`));
      await q(`UPDATE orders SET status = 'paid', stripe_session = $2, customer = $3::jsonb, stock_applied = $4, needs_review = $5,
               events = $6::jsonb, payment_intent = $7, paid_at = now(), updated_at = now() WHERE id = $1`,
      [orderId, sessionId, JSON.stringify(customer ?? {}), stockOk, needsReview, JSON.stringify(events), paymentIntent]);
      return { found: true, stockOk, amountOk };
    });
  }

  // Ends an unpaid checkout and puts its held stock back. Safe to call repeatedly.
  async function markOrderAbandoned(orderId, reason = 'Checkout ended without payment') {
    await db.tx(async (q) => {
      const { rows } = await q("SELECT * FROM orders WHERE id = $1 AND status = 'pending' FOR UPDATE", [orderId]);
      if (!rows.length) return;
      const order = orderRow(rows[0]);
      if (order.stock_applied) await returnStock(q, order.items);
      await q(`UPDATE orders SET status = 'abandoned', stock_applied = false, events = $2::jsonb, updated_at = now() WHERE id = $1`,
        [orderId, JSON.stringify([...order.events, event(`${reason}. Stock released.`)])]);
    });
  }

  // Notes a refund or chargeback that happened in Stripe. The status and stock stay as they are for a person to decide.
  async function recordPaymentIssue(paymentIntent, message, { reviewIfRefunded = true } = {}) {
    if (!paymentIntent) return;
    await db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE payment_intent = $1 FOR UPDATE', [paymentIntent]);
      if (!rows.length) return;
      const order = orderRow(rows[0]);
      if (order.events.some((e) => e.message === message)) return;
      const needsReview = order.needs_review || reviewIfRefunded || order.status !== 'refunded';
      await q('UPDATE orders SET needs_review = $2, events = $3::jsonb, updated_at = now() WHERE id = $1',
        [order.id, needsReview, JSON.stringify([...order.events, event(message)])]);
    });
  }

  // For sales made outside the website, such as Instagram messages or in person.
  async function createManualOrder(input) {
    const customer = {
      name: text(input?.customer?.name, 160),
      email: text(input?.customer?.email, 200),
      phone: text(input?.customer?.phone, 40),
      address: {
        line1: text(input?.customer?.address?.line1, 200),
        line2: text(input?.customer?.address?.line2, 200),
        city: text(input?.customer?.address?.city, 120),
        state: text(input?.customer?.address?.state, 80),
        postal_code: text(input?.customer?.address?.postal_code, 20),
        country: text(input?.customer?.address?.country, 2).toUpperCase(),
      },
    };
    if (!customer.name) throw new UserError('Customer name is required.');
    const shippingUsd = Number(input?.shippingUsd ?? 0);
    if (!Number.isFinite(shippingUsd) || shippingUsd < 0) throw new UserError('Shipping must be 0 or more.');
    const channel = text(input?.channel, 40) || 'manual';
    const note = text(input?.note, 2000);
    return db.tx(async (q) => {
      const { items, subtotal } = await priceCart(q, input?.items);
      if (!(await takeStock(q, items))) throw new UserError('One of those sizes just sold out.', 409);
      const shipping = Math.round(shippingUsd * 100);
      const id = randomUUID();
      const { rows } = await q(`INSERT INTO orders (id, status, channel, customer, items, subtotal_cents, shipping_cents, total_cents, note, stock_applied, events, paid_at, lang)
                 VALUES ($1, 'paid', $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, true, $9::jsonb, now(), $10) RETURNING number`,
      [id, channel, JSON.stringify(customer), JSON.stringify(items), subtotal, shipping, subtotal + shipping, note, JSON.stringify([event(`Manual order added (${channel})`)]), language(input?.lang)]);
      return { id, number: rows[0].number };
    });
  }

  async function listOrders({ status } = {}) {
    // Unfinished checkouts stay out of the main list, so it only shows orders that need handling.
    const filter = status === 'review'
      ? ["WHERE needs_review AND status NOT IN ('pending', 'abandoned')", []]
      : status && ORDER_STATUSES.includes(status)
        ? ['WHERE status = $1', [status]]
        : ["WHERE status NOT IN ('pending', 'abandoned')", []];
    const { rows } = await db.query(`SELECT * FROM orders ${filter[0]} ORDER BY created_at DESC LIMIT 200`, filter[1]);
    return rows.map(orderRow);
  }

  async function getOrder(id) {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ? orderRow(rows[0]) : null;
  }

  async function updateOrder(id, input) {
    return db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw new UserError('Order not found.', 404);
      const order = orderRow(rows[0]);
      const events = [...order.events];
      let { status, stock_applied: stockApplied, needs_review: needsReview } = order;

      if (input?.status && input.status !== order.status) {
        if (!NEXT_STATUS[order.status]?.includes(input.status)) throw new UserError(`An order cannot go from ${order.status} to ${input.status}.`);
        status = input.status;
        events.push(event(`Status changed to ${status}`));
        if (RESTOCK_STATUSES.has(status) && stockApplied) {
          await returnStock(q, order.items);
          stockApplied = false;
          events.push(event('Items returned to stock'));
        }
      }
      const carrier = input?.carrier !== undefined ? text(input.carrier, 80) : order.carrier;
      const tracking = input?.tracking !== undefined ? text(input.tracking, 120) : order.tracking;
      const note = input?.note !== undefined ? text(input.note, 2000) : order.note;
      if (tracking !== order.tracking) events.push(event(tracking ? `Tracking set to ${tracking}` : 'Tracking removed'));
      if (input?.needsReview === false && needsReview) {
        needsReview = false;
        events.push(event('Marked as reviewed'));
      }
      await q(`UPDATE orders SET status = $2, carrier = $3, tracking = $4, note = $5, stock_applied = $6, needs_review = $7, events = $8::jsonb, updated_at = now() WHERE id = $1`,
        [id, status, carrier, tracking, note, stockApplied, needsReview, JSON.stringify(events)]);
    }).then(() => getOrder(id));
  }

  // Removes an order for good. Any stock it still holds goes back on the shelf.
  // A checkout in progress can't be deleted, because the customer could still pay for it.
  async function deleteOrder(id) {
    return db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw new UserError('Order not found.', 404);
      const order = orderRow(rows[0]);
      if (order.status === 'pending') throw new UserError('This customer is still at checkout. It ends on its own within about 30 minutes, and then it can be deleted.', 409);
      if (order.stock_applied) await returnStock(q, order.items);
      await q('DELETE FROM orders WHERE id = $1', [id]);
      return { number: order.number, restocked: order.stock_applied };
    });
  }

  // Reserves an email before it goes out, so two saves at once can't send it twice.
  // Returns the order, or null if this email (with this key) was already sent.
  async function claimEmail(orderId, kind, keyOf, { force = false } = {}) {
    return db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!rows.length) throw new UserError('Order not found.', 404);
      const order = orderRow(rows[0]);
      const key = keyOf(order);
      const previous = order.emails[kind] ?? null;
      if (!force && previous?.key === key) return null;
      const emails = { ...order.emails, [kind]: { key, at: new Date().toISOString(), previous } };
      await q('UPDATE orders SET emails = $2::jsonb WHERE id = $1', [orderId, JSON.stringify(emails)]);
      return order;
    });
  }

  // Notes how an email went. A failed one is un-reserved so it can be sent again.
  async function finishEmail(orderId, kind, { ok, message }) {
    await db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!rows.length) return;
      const order = orderRow(rows[0]);
      const emails = { ...order.emails };
      const { previous = null, ...sent } = emails[kind] ?? {};
      if (ok) emails[kind] = sent;
      else if (previous) emails[kind] = previous;
      else delete emails[kind];
      await q('UPDATE orders SET emails = $2::jsonb, events = $3::jsonb, updated_at = now() WHERE id = $1',
        [orderId, JSON.stringify(emails), JSON.stringify([...order.events, event(message)])]);
    });
  }

  // --- Shippo ---
  async function noteShippoOrder(orderId, shippoOrder, message) {
    await db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!rows.length) return;
      const order = orderRow(rows[0]);
      await q('UPDATE orders SET shippo_order = coalesce($2, shippo_order), events = $3::jsonb, updated_at = now() WHERE id = $1',
        [orderId, shippoOrder, JSON.stringify([...order.events, event(message)])]);
    });
  }

  async function ordersAwaitingLabel() {
    const { rows } = await db.query("SELECT * FROM orders WHERE shippo_order IS NOT NULL AND status IN ('paid', 'packed', 'shipped') ORDER BY created_at DESC LIMIT 100");
    return rows.map(orderRow);
  }

  // A label bought in Shippo marks the order shipped with its tracking number.
  async function recordShippoLabel(orderId, { carrier, tracking }) {
    await db.tx(async (q) => {
      const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!rows.length) return;
      const order = orderRow(rows[0]);
      if (order.tracking === tracking) return;
      const events = [...order.events, event(`Label bought in Shippo${carrier ? ` (${carrier})` : ''}. Tracking set to ${tracking}`)];
      if (order.status !== 'shipped') events.push(event('Status changed to shipped'));
      await q(`UPDATE orders SET status = 'shipped', carrier = $2, tracking = $3, events = $4::jsonb, updated_at = now() WHERE id = $1`,
        [orderId, text(carrier, 80), text(tracking, 120), JSON.stringify(events)]);
    });
    return getOrder(orderId);
  }

  async function markDeliveredByTracking(tracking) {
    return db.tx(async (q) => {
      const { rows } = await q("SELECT * FROM orders WHERE tracking = $1 AND status = 'shipped' FOR UPDATE", [tracking]);
      if (rows.length !== 1) return null;
      const order = orderRow(rows[0]);
      await q(`UPDATE orders SET status = 'delivered', events = $2::jsonb, updated_at = now() WHERE id = $1`,
        [order.id, JSON.stringify([...order.events, event('Carrier shows the package delivered')])]);
      return order.id;
    });
  }

  async function orderCounts() {
    const { rows } = await db.query('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
    const review = await db.query("SELECT count(*)::int AS n FROM orders WHERE needs_review AND status NOT IN ('pending', 'abandoned')");
    return { ...Object.fromEntries(rows.map((r) => [r.status, r.n])), review: review.rows[0].n };
  }

  return {
    seedJerseys, listPublicJerseys, listAllJerseys, createJersey, updateJersey, moveJersey,
    saveMedia, getMedia, getSettings, saveSettings,
    createPendingOrder, attachCheckoutSession, markOrderPaid, markOrderAbandoned, recordPaymentIssue, createManualOrder,
    listOrders, getOrder, updateOrder, deleteOrder, orderCounts, claimEmail, finishEmail,
    noteShippoOrder, ordersAwaitingLabel, recordShippoLabel, markDeliveredByTracking,
  };
}

export { NEXT_STATUS };
