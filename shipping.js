// Shippo (goshippo.com): paid orders are copied into Shippo, where labels are bought.
// When a label is bought, Shippo tells this site, which saves the tracking number and sends
// the customer the shipping email from this site's own address. Shippo never emails customers.
// Nothing is sent to Shippo until SHIPPO_API_KEY is set.
import { sendOrderEmail, shippingEmailDue } from './email.js';

const API = 'https://api.goshippo.com';
const apiKey = () => process.env.SHIPPO_API_KEY || '';
// A typical jersey in a poly mailer. Shippo lets you change the weight before buying a label.
const OUNCES_PER_JERSEY = 10;

export function shippoStatus() {
  const key = apiKey();
  return {
    enabled: Boolean(key),
    mode: key.startsWith('shippo_live') ? 'live' : key.startsWith('shippo_test') ? 'test' : 'none',
    missing: key ? [] : ['SHIPPO_API_KEY is not set'],
  };
}

async function shippoFetch(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `ShippoToken ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || JSON.stringify(data).slice(0, 200) || `Shippo answered ${response.status}`);
  return data;
}

const dollars = (cents) => (cents / 100).toFixed(2);

export function shippoOrderBody(order) {
  const c = order.customer ?? {};
  const a = c.address ?? {};
  const units = order.items.reduce((sum, i) => sum + i.qty, 0);
  return {
    order_number: `#${order.number}`,
    order_status: 'PAID',
    placed_at: new Date(order.paid_at || order.created_at || Date.now()).toISOString(),
    to_address: {
      name: c.name || '', street1: a.line1 || '', street2: a.line2 || '', city: a.city || '',
      state: a.state || '', zip: a.postal_code || '', country: a.country || 'US', phone: c.phone || '', email: c.email || '',
    },
    line_items: order.items.map((i) => ({
      title: `${i.title} (${i.section === 'women' ? 'Women’s ' : ''}${i.size})`,
      sku: `${i.slug}-${i.section || 'men'}-${i.size}`,
      quantity: i.qty,
      total_price: dollars(i.unitCents * i.qty),
      currency: 'USD',
      weight: String(OUNCES_PER_JERSEY * i.qty),
      weight_unit: 'oz',
    })),
    weight: String(OUNCES_PER_JERSEY * units),
    weight_unit: 'oz',
    shipping_cost: dollars(order.shipping_cents),
    shipping_cost_currency: 'USD',
    subtotal_price: dollars(order.subtotal_cents),
    total_price: dollars(order.total_cents),
    currency: 'USD',
  };
}

// Copies one order into Shippo. Never throws, so a Shippo problem can't break a payment or an admin save.
export async function sendOrderToShippo(store, orderId, { force = false, request = shippoFetch } = {}) {
  const order = await store.getOrder(orderId);
  if (!order) return { sent: false, reason: 'order not found' };
  if (order.shippo_order && !force) return { sent: false, reason: 'already in Shippo' };
  // Until Shippo is connected, orders are shipped by hand and the timeline stays quiet about it.
  if (request === shippoFetch && !shippoStatus().enabled && !force) return { sent: false, reason: 'Shippo is not set up yet' };
  let problem = '';
  if (request === shippoFetch && !shippoStatus().enabled) problem = 'Shippo is not set up yet';
  else if (!order.customer?.address?.line1) problem = 'the order has no shipping address';
  let created;
  if (!problem) {
    try {
      created = await request('/orders/', { method: 'POST', body: shippoOrderBody(order) });
    } catch (error) {
      console.error(`Sending order ${order.id} to Shippo failed:`, error);
      problem = `Shippo answered: ${String(error.message || error).slice(0, 200)}`;
    }
  }
  if (problem) {
    await store.noteShippoOrder(orderId, null, `Not sent to Shippo: ${problem}.`);
    return { sent: false, reason: problem };
  }
  await store.noteShippoOrder(orderId, created.object_id, 'Sent to Shippo to buy a label');
  return { sent: true };
}

const shippoId = (value) => (typeof value === 'string' ? value : value?.object_id) || '';

// Shippo's webhook messages aren't signed, so each one is only a hint: the details are always
// re-read from Shippo with this site's own key, and a forged message can't change anything.
export async function handleShippoEvent(store, payload, { request = shippoFetch, sendEmail = sendOrderEmail } = {}) {
  const type = payload?.event;
  const data = payload?.data ?? {};
  if (type === 'transaction_created' || type === 'transaction_updated') {
    const id = shippoId(data);
    if (!/^[a-f0-9]{32}$/.test(id)) return { handled: false, reason: 'no label id' };
    const label = await request(`/transactions/${id}`);
    if (label.status !== 'SUCCESS' || !label.tracking_number) return { handled: false, reason: 'label not ready' };
    const order = await findOrderForLabel(store, label, request);
    if (!order) return { handled: false, reason: 'no matching order' };
    const rate = typeof label.rate === 'string' ? await request(`/rates/${label.rate}`).catch(() => ({})) : label.rate ?? {};
    const updated = await store.recordShippoLabel(order.id, { carrier: rate.provider || order.carrier, tracking: label.tracking_number });
    if (shippingEmailDue(updated)) await sendEmail(store, updated.id, 'shipping');
    return { handled: true, orderId: order.id };
  }
  if (type === 'track_updated') {
    const carrier = String(data.carrier || '').toLowerCase();
    const tracking = String(data.tracking_number || '');
    if (!/^[a-z0-9_]{2,40}$/.test(carrier) || !/^[A-Za-z0-9]{6,60}$/.test(tracking)) return { handled: false, reason: 'no tracking number' };
    const track = await request(`/tracks/${carrier}/${tracking}`);
    if (track.tracking_status?.status !== 'DELIVERED') return { handled: false, reason: 'not delivered yet' };
    const orderId = await store.markDeliveredByTracking(tracking);
    return orderId ? { handled: true, orderId } : { handled: false, reason: 'no matching order' };
  }
  return { handled: false, reason: 'ignored event' };
}

// Finds which of this site's orders a Shippo label belongs to.
async function findOrderForLabel(store, label, request) {
  const linked = shippoId(label.order);
  const candidates = await store.ordersAwaitingLabel();
  if (linked) return candidates.find((o) => o.shippo_order === linked) ?? null;
  // Older labels may not name their order, so check each waiting order's list of labels.
  for (const order of candidates) {
    const shippoOrder = await request(`/orders/${order.shippo_order}`).catch(() => null);
    if (shippoOrder?.transactions?.some((t) => shippoId(t) === label.object_id)) return order;
  }
  return null;
}
