// Customer emails: the order confirmation and the shipping notice, in English or Spanish.
// Sent through Resend (resend.com). Nothing is sent until RESEND_API_KEY and EMAIL_FROM are set.

const publicUrl = () => (process.env.PUBLIC_URL || 'https://90-00.com').replace(/\/$/, '');

export function emailStatus() {
  const missing = [];
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY is not set');
  if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM is not set (the sender, such as "90:00 Archive <orders@90-00.com>")');
  return { enabled: missing.length === 0, missing, from: process.env.EMAIL_FROM || '', replyTo: process.env.EMAIL_REPLY_TO || '' };
}

async function sendWithResend({ to, subject, html, text, idempotencyKey }) {
  const { from, replyTo } = emailStatus();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Resend answered ${response.status}`);
  }
}

// --- Wording ---
const WORDS = {
  en: {
    confirmSubject: (n) => `Order #${n} confirmed · 90:00 Archive`,
    confirmHeading: (name) => (name ? `Thanks, ${name}.` : 'Thanks for your order.'),
    confirmIntro: (many) => `Your payment went through, and we’re getting your ${many ? 'jerseys' : 'jersey'} ready to ship. We’ll email you the tracking number once ${many ? 'they’re' : 'it’s'} on the way.`,
    shipSubject: (n) => `Order #${n} has shipped · 90:00 Archive`,
    shipHeading: 'Your order is on the way.',
    shipIntro: (many) => `${many ? 'Your jerseys have' : 'Your jersey has'} shipped. Use the tracking number below to follow it.`,
    order: (n) => `Order #${n}`,
    size: (item) => (item.section === 'women' ? `Women’s size ${item.size}` : `Size ${item.size}`),
    qty: 'Qty',
    subtotal: 'Subtotal',
    shipping: 'Shipping',
    free: 'Free',
    total: 'Total',
    shipTo: 'Shipping to',
    carrier: 'Carrier',
    tracking: 'Tracking number',
    track: 'Track your package',
    questions: 'Questions about your order? Reply to this email.',
  },
  es: {
    confirmSubject: (n) => `Pedido #${n} confirmado · 90:00 Archive`,
    confirmHeading: (name) => (name ? `¡Gracias, ${name}!` : '¡Gracias por tu pedido!'),
    confirmIntro: (many) => `Tu pago se procesó y ya estamos preparando ${many ? 'tus camisolas' : 'tu camisola'} para enviar${many ? 'las' : 'la'}. Te vamos a mandar el número de rastreo por correo cuando ${many ? 'vayan' : 'vaya'} en camino.`,
    shipSubject: (n) => `Tu pedido #${n} va en camino · 90:00 Archive`,
    shipHeading: 'Tu pedido va en camino.',
    shipIntro: (many) => `Ya ${many ? 'enviamos tus camisolas' : 'enviamos tu camisola'}. Con el número de rastreo de abajo podés seguir el paquete.`,
    order: (n) => `Pedido #${n}`,
    size: (item) => (item.section === 'women' ? `Talla ${item.size} de mujer` : `Talla ${item.size}`),
    qty: 'Cant.',
    subtotal: 'Subtotal',
    shipping: 'Envío',
    free: 'Gratis',
    total: 'Total',
    shipTo: 'Se envía a',
    carrier: 'Empresa de envío',
    tracking: 'Número de rastreo',
    track: 'Rastrear tu paquete',
    questions: '¿Tenés preguntas sobre tu pedido? Respondé a este correo.',
  },
};

const TRACKING_PAGES = [
  [/usps/i, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
  [/ups/i, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/fedex/i, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/dhl/i, (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`],
];

export function trackingUrl(carrier, tracking) {
  const page = TRACKING_PAGES.find(([pattern]) => pattern.test(carrier || ''));
  return page && tracking ? page[1](encodeURIComponent(tracking)) : '';
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const many = (order) => order.items.reduce((sum, i) => sum + i.qty, 0) > 1;
const itemDetail = (item) => [item.team && !String(item.title).includes(item.team) && item.team, item.player && `${item.player} #${item.number}`].filter(Boolean).join(' · ');

function addressLines(customer) {
  const a = customer?.address ?? {};
  return [
    customer?.name,
    a.line1,
    a.line2,
    [[a.city, a.state].filter(Boolean).join(', '), a.postal_code].filter(Boolean).join(' '),
    a.country,
  ].filter(Boolean);
}

// Colors match the website: near-black page, warm sand card, gold accent.
const C = { page: '#0d0c0a', card: '#d9c9ae', ink: '#1a150d', muted: '#5b4f3c', gold: '#bfa06a', line: 'rgba(26,21,13,0.22)' };
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function layout({ lang, preheader, body }) {
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>90:00 Archive</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 24px;">
      <a href="${publicUrl()}"><img src="${publicUrl()}/assets/logo-ivory.png" alt="90:00 Archive" width="180" style="display:block;width:180px;height:auto;border:0;"></a>
    </td></tr>
    <tr><td style="background:${C.card};border-radius:6px;padding:32px 28px;font-family:${FONT};color:${C.ink};font-size:16px;line-height:1.55;">
      ${body}
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;font-family:${FONT};font-size:13px;color:#aca291;">
      <a href="${publicUrl()}" style="color:${C.gold};text-decoration:none;">90-00.com</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const heading = (text) => `<h1 style="margin:0 0 12px;font-family:'Bodoni Moda',Didot,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:1.2;color:${C.ink};">${esc(text)}</h1>`;
const para = (text, extra = '') => `<p style="margin:0 0 20px;${extra}">${esc(text)}</p>`;
const label = (text) => `<p style="margin:24px 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};">${esc(text)}</p>`;

function itemsTable(order, w, { prices }) {
  const rows = order.items.map((item) => `<tr>
    <td style="padding:10px 0;border-top:1px solid ${C.line};vertical-align:top;">
      <strong>${esc(item.title)}</strong>
      ${itemDetail(item) ? `<br><span style="color:${C.muted};font-size:14px;">${esc(itemDetail(item))}</span>` : ''}
      <br><span style="font-size:14px;">${esc(w.size(item))} · ${esc(w.qty)} ${esc(item.qty)}</span>
    </td>
    ${prices ? `<td align="right" style="padding:10px 0 10px 12px;border-top:1px solid ${C.line};vertical-align:top;white-space:nowrap;">${esc(usd(item.unitCents * item.qty))}</td>` : ''}
  </tr>`).join('');
  if (!prices) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  const line = (name, value, bold) => `<tr><td style="padding:4px 0;${bold ? 'font-weight:bold;' : `color:${C.muted};`}">${esc(name)}</td><td align="right" style="padding:4px 0;${bold ? 'font-weight:bold;' : ''}">${esc(value)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
    <tr><td colspan="2" style="border-top:1px solid ${C.line};padding-top:6px;"></td></tr>
    ${line(w.subtotal, usd(order.subtotal_cents))}
    ${line(w.shipping, order.shipping_cents ? usd(order.shipping_cents) : w.free)}
    ${line(w.total, usd(order.total_cents), true)}
  </table>`;
}

const addressBlock = (order) => `<p style="margin:0;">${addressLines(order.customer).map(esc).join('<br>')}</p>`;

function itemsText(order, w, { prices }) {
  const lines = order.items.map((item) => [
    `- ${item.title}${itemDetail(item) ? ` (${itemDetail(item)})` : ''}`,
    `  ${w.size(item)} · ${w.qty} ${item.qty}${prices ? ` · ${usd(item.unitCents * item.qty)}` : ''}`,
  ].join('\n'));
  if (prices) {
    lines.push('', `${w.subtotal}: ${usd(order.subtotal_cents)}`, `${w.shipping}: ${order.shipping_cents ? usd(order.shipping_cents) : w.free}`, `${w.total}: ${usd(order.total_cents)}`);
  }
  return lines.join('\n');
}

export function confirmationEmail(order) {
  const lang = order.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const name = firstName(order.customer?.name);
  const intro = w.confirmIntro(many(order));
  const html = layout({
    lang,
    preheader: intro,
    body: `${heading(w.confirmHeading(name))}
      ${para(intro)}
      ${label(w.order(order.number))}
      ${itemsTable(order, w, { prices: true })}
      ${addressLines(order.customer).length ? `${label(w.shipTo)}${addressBlock(order)}` : ''}
      ${para(w.questions, `margin:28px 0 0;color:${C.muted};font-size:14px;`)}`,
  });
  const text = [
    w.confirmHeading(name), '', intro, '', w.order(order.number), itemsText(order, w, { prices: true }),
    ...(addressLines(order.customer).length ? ['', `${w.shipTo}:`, ...addressLines(order.customer)] : []),
    '', w.questions, '', publicUrl(),
  ].join('\n');
  return { subject: w.confirmSubject(order.number), html, text };
}

export function shippingEmail(order) {
  const lang = order.lang === 'es' ? 'es' : 'en';
  const w = WORDS[lang];
  const intro = w.shipIntro(many(order));
  const link = trackingUrl(order.carrier, order.tracking);
  const html = layout({
    lang,
    preheader: intro,
    body: `${heading(w.shipHeading)}
      ${para(intro)}
      ${order.carrier ? `${label(w.carrier)}<p style="margin:0;">${esc(order.carrier)}</p>` : ''}
      ${label(w.tracking)}<p style="margin:0;font-size:18px;letter-spacing:0.04em;"><strong>${esc(order.tracking)}</strong></p>
      ${link ? `<p style="margin:24px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:${C.ink};color:${C.card};text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;">${esc(w.track)}</a></p>` : ''}
      ${label(w.order(order.number))}
      ${itemsTable(order, w, { prices: false })}
      ${addressLines(order.customer).length ? `${label(w.shipTo)}${addressBlock(order)}` : ''}
      ${para(w.questions, `margin:28px 0 0;color:${C.muted};font-size:14px;`)}`,
  });
  const text = [
    w.shipHeading, '', intro, '',
    ...(order.carrier ? [`${w.carrier}: ${order.carrier}`] : []),
    `${w.tracking}: ${order.tracking}`,
    ...(link ? [`${w.track}: ${link}`] : []),
    '', w.order(order.number), itemsText(order, w, { prices: false }),
    ...(addressLines(order.customer).length ? ['', `${w.shipTo}:`, ...addressLines(order.customer)] : []),
    '', w.questions, '', publicUrl(),
  ].join('\n');
  return { subject: w.shipSubject(order.number), html, text };
}

// --- Sending ---
const KINDS = {
  confirmation: { build: confirmationEmail, label: 'Confirmation email', key: () => 'sent' },
  shipping: { build: shippingEmail, label: 'Shipping email', key: (order) => order.tracking },
};

// True when an order has a tracking number the customer hasn't been emailed yet.
export const shippingEmailDue = (order) => order.status === 'shipped' && Boolean(order.tracking) && order.emails?.shipping?.key !== order.tracking;

// Sends one email for an order and notes the result on its timeline. Never throws, so a mail
// problem can't break a payment confirmation or an admin save. `force` resends one already sent.
export async function sendOrderEmail(store, orderId, kind, { force = false, send = sendWithResend } = {}) {
  const spec = KINDS[kind];
  const status = emailStatus();
  const claim = await store.claimEmail(orderId, kind, spec.key, { force });
  if (!claim) return { sent: false, reason: 'already sent' };
  const order = claim;
  const to = order.customer?.email;
  let problem = '';
  if (!to) problem = 'the order has no customer email';
  else if (kind === 'shipping' && !order.tracking) problem = 'the order has no tracking number';
  else if (send === sendWithResend && !status.enabled) problem = 'email is not set up yet';
  if (!problem) {
    try {
      await send({ to, ...spec.build(order), idempotencyKey: `${kind}-${order.id}-${spec.key(order)}${force ? `-${Date.now()}` : ''}` });
    } catch (error) {
      console.error(`${spec.label} for order ${order.id} failed:`, error);
      problem = `the email service answered: ${String(error.message || error).slice(0, 200)}`;
    }
  }
  await store.finishEmail(orderId, kind, problem
    ? { ok: false, message: `${spec.label} not sent: ${problem}.` }
    : { ok: true, message: `${spec.label} sent to ${to} (${order.lang === 'es' ? 'Spanish' : 'English'})` });
  return problem ? { sent: false, reason: problem } : { sent: true };
}
