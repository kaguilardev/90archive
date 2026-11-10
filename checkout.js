// Stripe Checkout. Real sales stay off until CHECKOUT_ENABLED is "true" and everything below is set.
import Stripe from 'stripe';
import { sendOrderEmail } from './email.js';
import { sendOrderToShippo } from './shipping.js';

const stripeKey = () => process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || '';
const publicUrl = () => (process.env.PUBLIC_URL || 'https://90-00.com').replace(/\/$/, '');

let client;
const stripe = () => {
  client ??= new Stripe(stripeKey());
  return client;
};

export function checkoutStatus(settings) {
  const missing = [];
  if (process.env.CHECKOUT_ENABLED !== 'true') missing.push('CHECKOUT_ENABLED is not "true"');
  if (!stripeKey()) missing.push('STRIPE_SECRET_KEY is not set');
  if (!webhookSecret()) missing.push('STRIPE_WEBHOOK_SECRET is not set');
  if (settings?.shippingCents == null) missing.push('The shipping rate is not set');
  return {
    enabled: missing.length === 0,
    missing,
    mode: stripeKey().startsWith('sk_live') ? 'live' : stripeKey().startsWith('sk_test') ? 'test' : 'none',
  };
}

// Stripe's minimum is 30 minutes from when it receives the request, so this allows a little extra.
const CHECKOUT_MINUTES = 31;

export async function startCheckout(store, lines, { lang = 'en', stripeClient = stripe() } = {}) {
  const settings = await store.getSettings();
  const order = await store.createPendingOrder(lines, settings, lang);
  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    locale: lang === 'es' ? 'es' : 'en',
    client_reference_id: order.id,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    line_items: order.items.map((item) => ({
      quantity: item.qty,
      price_data: {
        currency: 'usd',
        unit_amount: item.unitCents,
        product_data: {
          name: `${item.title} (${item.section === 'women' ? 'Women\'s ' : ''}${item.size})`,
          description: [item.team, item.player && `${item.player} #${item.number}`].filter(Boolean).join(' · '),
        },
      },
    })),
    shipping_address_collection: { allowed_countries: settings.countries },
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: order.shipping === 0 ? 'Free shipping' : 'Shipping',
        fixed_amount: { amount: order.shipping, currency: 'usd' },
      },
    }],
    success_url: `${publicUrl()}/order/complete`,
    cancel_url: `${publicUrl()}/cart`,
  }).catch(async (error) => {
    await store.markOrderAbandoned(order.id, 'Stripe could not start checkout');
    throw error;
  });
  await store.attachCheckoutSession(order.id, session.id);
  return session.url;
}

function customerFromSession(session) {
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details ?? session.shipping ?? {};
  const details = session.customer_details ?? {};
  return {
    name: shipping.name || details.name || '',
    email: details.email || '',
    phone: details.phone || '',
    address: shipping.address || details.address || {},
  };
}

// Stripe calls this after payment. The signature proves the message really came from Stripe.
export function parseWebhook(rawBody, signature, stripeClient = stripe(), secret = webhookSecret()) {
  return stripeClient.webhooks.constructEvent(rawBody, signature, secret);
}

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function handleStripeEvent(store, event, { sendEmail = sendOrderEmail, toShippo = sendOrderToShippo } = {}) {
  const object = event.data.object;
  if (event.type === 'charge.refunded') {
    await store.recordPaymentIssue(object.payment_intent, `Stripe shows ${usd(object.amount_refunded)} refunded on this payment.`, { reviewIfRefunded: false });
    return;
  }
  if (event.type === 'charge.dispute.created') {
    await store.recordPaymentIssue(object.payment_intent, `The customer opened a chargeback for ${usd(object.amount)} (${object.reason}). Respond in the Stripe dashboard.`);
    return;
  }
  const orderId = object.client_reference_id;
  if (!orderId) return;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status !== 'paid') return;
    const result = await store.markOrderPaid({ orderId, sessionId: object.id, paymentIntent: object.payment_intent, customer: customerFromSession(object), totalCents: object.amount_total });
    if (!result.found || result.alreadyHandled) return;
    // If the jersey sold out first, telling the customer it's on the way would be wrong. Send it from the admin once sorted.
    if (!result.stockOk) await store.finishEmail(orderId, 'confirmation', { ok: false, message: 'Confirmation email held because the stock ran out. Send it from this page once the order is sorted.' });
    else {
      await sendEmail(store, orderId, 'confirmation');
      await toShippo(store, orderId);
    }
  } else if (event.type === 'checkout.session.async_payment_failed') {
    await store.markOrderAbandoned(orderId, 'Delayed payment failed');
  } else if (event.type === 'checkout.session.expired') {
    await store.markOrderAbandoned(orderId, 'Checkout expired without payment');
  }
}
