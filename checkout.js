// Stripe Checkout. Real sales stay off until CHECKOUT_ENABLED is "true" and everything below is set.
import Stripe from 'stripe';

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

export async function startCheckout(store, lines) {
  const settings = await store.getSettings();
  const order = await store.createPendingOrder(lines, settings);
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    client_reference_id: order.id,
    line_items: order.items.map((item) => ({
      quantity: item.qty,
      price_data: {
        currency: 'usd',
        unit_amount: item.unitCents,
        product_data: {
          name: `${item.title} (${item.size})`,
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

export async function handleStripeEvent(store, event) {
  const session = event.data.object;
  const orderId = session.client_reference_id;
  if (!orderId) return;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (session.payment_status !== 'paid') return;
    await store.markOrderPaid({ orderId, sessionId: session.id, customer: customerFromSession(session), totalCents: session.amount_total });
  } else if (event.type === 'checkout.session.expired') {
    await store.markOrderAbandoned(orderId);
  }
}
