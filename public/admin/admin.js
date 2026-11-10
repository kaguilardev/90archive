const view = document.getElementById('view');
const top = document.getElementById('top');
const toastBox = document.getElementById('toast');
const API = '/admin/api';
const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

// Order and customer details come from the public, so every value shown is escaped.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const lines = (value) => String(value ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
const paragraphs = (value) => String(value ?? '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

let overview = null;
let dirty = false;

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

function toast(message, isError = false) {
  toastBox.textContent = message;
  toastBox.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastBox.className = ''; }, isError ? 6000 : 2800);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const options = { method, headers: {} };
  if (raw) {
    options.body = raw;
    options.headers['Content-Type'] = raw.type;
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(API + path, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/login') {
    dirty = false;
    await route();
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function go(path) {
  if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
  dirty = false;
  history.pushState(null, '', path);
  route();
}

const toDo = () => (overview?.counts?.paid ?? 0) + (overview?.counts?.packed ?? 0);

function renderTop(signedIn) {
  if (!signedIn) {
    top.innerHTML = '';
    return;
  }
  const path = location.pathname;
  top.innerHTML = `<div class="topbar">
    <a class="brand" href="/admin" data-link>90:00<span>Admin</span></a>
    <nav>
      <a href="/admin" data-link ${path === '/admin' || path.startsWith('/admin/orders') ? 'aria-current="page"' : ''}>Orders${toDo() ? `<span class="count">${toDo()}</span>` : ''}</a>
      <a href="/admin/jerseys" data-link ${path.startsWith('/admin/jerseys') ? 'aria-current="page"' : ''}>Jerseys</a>
      <a href="/admin/settings" data-link ${path.startsWith('/admin/settings') ? 'aria-current="page"' : ''}>Settings</a>
    </nav>
    <div class="right">
      <a class="small" href="/" target="_blank" rel="noopener">View site ↗</a>
      <button class="linklike small" type="button" data-action="logout">Sign out</button>
    </div>
  </div>`;
}

// --- Login ---
function renderLogin(session) {
  document.title = 'Sign in · 90:00 Archive';
  if (!session.configured) {
    view.innerHTML = `<section class="login card"><h1>Admin is not set up</h1>
      <p class="muted">Add an ADMIN_PASSWORD setting of at least 12 characters on Render, then reload this page.</p></section>`;
    return;
  }
  view.innerHTML = `<section class="login card">
    <h1>Sign in</h1>
    <form data-form="login" novalidate>
      <div class="field"><label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus></div>
      <p class="form-error field" role="alert"></p>
      <button class="btn primary big" type="submit" style="width:100%">Sign in</button>
    </form>
  </section>`;
}

// --- Orders ---
// Plain words for each status, and what Keeley does next.
const STATUS = {
  pending: { label: 'Checkout unfinished', next: 'Customer hasn’t paid yet' },
  paid: { label: 'To pack', next: 'Pack it' },
  packed: { label: 'To ship', next: 'Buy the label' },
  shipped: { label: 'Shipped', next: 'On the way' },
  delivered: { label: 'Delivered', next: 'Done' },
  cancelled: { label: 'Cancelled', next: '' },
  refunded: { label: 'Refunded', next: '' },
  abandoned: { label: 'Abandoned', next: '' },
};
const statusBadge = (order) => `<span class="badge ${esc(order.status)}">${esc(STATUS[order.status]?.label ?? order.status)}</span>`;
const shortAddress = (c) => [c?.address?.city, c?.address?.state].filter(Boolean).join(', ');
const sizeTag = (item) => `<span class="size">${esc(item.size)}</span>${item.section === 'women' ? ' women’s' : ''}`;
const itemLine = (item) => `${esc(item.title)} · ${sizeTag(item)}${item.qty > 1 ? ` × ${esc(item.qty)}` : ''}`;

const TRACKING_PAGES = [
  [/usps/i, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
  [/ups/i, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/fedex/i, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/dhl/i, (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`],
];
const trackingUrl = (carrier, tracking) => {
  const page = TRACKING_PAGES.find(([pattern]) => pattern.test(carrier || ''));
  return page && tracking ? page[1](encodeURIComponent(tracking)) : '';
};

async function renderOrders() {
  document.title = 'Orders · 90:00 Archive';
  const status = new URLSearchParams(location.search).get('status') || '';
  const orders = await api(`/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const counts = overview.counts;
  const all = ['paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'].reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  const tile = (value, label, cls) => `<a class="tile ${(counts[value] ?? 0) ? cls : ''}" href="/admin?status=${value}" data-link aria-current="${status === value}">
    <strong>${esc(counts[value] ?? 0)}</strong><span>${label}</span></a>`;
  const tab = (value, label, n) => `<a href="/admin${value ? `?status=${value}` : ''}" data-link aria-current="${status === value}">${label} (${n ?? 0})</a>`;
  view.innerHTML = `
    <div class="page-head"><h1>Orders</h1><a class="btn primary" href="/admin/orders/new" data-link>+ Add manual order</a></div>
    ${checkoutNotice()}
    <div class="tiles">
      ${tile('paid', 'To pack', 'hot')}
      ${tile('packed', 'To ship', 'hot')}
      ${tile('review', 'Need a look', 'alert')}
    </div>
    <div class="tabs">${tab('', 'All', all)}${tab('shipped', 'Shipped', counts.shipped)}${tab('delivered', 'Delivered', counts.delivered)}${tab('cancelled', 'Cancelled', counts.cancelled)}${tab('refunded', 'Refunded', counts.refunded)}${tab('pending', 'Unfinished checkouts', counts.pending)}</div>
    ${orders.length ? `<div class="list">${orders.map((o) => `<a class="order-row" href="/admin/orders/${esc(o.id)}" data-link>
      <div class="order-number">#${esc(o.number)}</div>
      <div><strong>${esc(o.customer?.name || 'No name yet')}</strong>
        <div class="muted small">${esc(shortAddress(o.customer) || o.channel)}</div></div>
      <div class="what">${o.items.map((i) => `<div>${itemLine(i)}</div>`).join('')}</div>
      <div class="muted small nowrap when">${esc(day(o.created_at))}<div class="money">${esc(money(o.total_cents))}</div></div>
      <div class="status">${o.needs_review ? '<span class="badge alert">Look</span> ' : ''}${statusBadge(o)}
        ${STATUS[o.status]?.next && !['delivered'].includes(o.status) ? `<span class="next">${esc(STATUS[o.status].next)}</span>` : ''}</div>
    </a>`).join('')}</div>` : `<p class="empty card">${status ? 'Nothing here right now.' : 'No orders yet.'}</p>`}`;
}

function checkoutNotice() {
  const c = overview.checkout;
  if (c.enabled) {
    return c.mode === 'test' ? '<p class="notice info">Checkout is on in Stripe <strong>test mode</strong>. No real money moves.</p>' : '';
  }
  return '<p class="notice">Online checkout is off, so website orders won’t come in yet. You can still add manual orders. <a href="/admin/settings" data-link>What’s missing</a></p>';
}

const ORDER_ACTIONS = {
  paid: { label: 'Mark as paid' },
  packed: { label: 'Mark as packed' },
  shipped: { label: 'Mark as shipped' },
  delivered: { label: 'Mark as delivered' },
  cancelled: { label: 'Cancel order', danger: true, confirm: 'Cancel this order and put its items back in stock?' },
  refunded: { label: 'Mark as refunded', danger: true, confirm: 'Mark as refunded and put the items back in stock? This does not send money back. Issue the refund in Stripe first.' },
};
// The one forward step for each status. Everything else is tucked under "Other actions".
const FORWARD = { pending: 'paid', paid: 'packed', packed: 'shipped', shipped: 'delivered' };
const STEPS = [['paid', 'Paid'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];

function nextStepCard(order, next) {
  const forward = next.includes(FORWARD[order.status]) ? FORWARD[order.status] : null;
  const others = next.filter((s) => s !== forward);
  const shippo = overview.shippo?.enabled && order.shippo_order;
  const say = {
    pending: 'The customer started checkout but hasn’t paid.',
    paid: 'Pull the jerseys below and pack them. Then mark it packed.',
    packed: shippo
      ? 'Buy the label for this order in Shippo. This page then switches to shipped and emails the customer the tracking number.'
      : 'Buy the label, add the tracking number under Shipping, then mark it shipped.',
    shipped: 'It’s on the way. It switches to delivered on its own when the carrier confirms.',
    delivered: 'All done.',
    cancelled: 'This order was cancelled.',
    refunded: 'This order was refunded.',
    abandoned: 'Checkout ended without payment.',
  }[order.status] ?? '';
  const button = (s, cls) => {
    const action = ORDER_ACTIONS[s] ?? { label: s };
    return `<button class="${cls}${action.danger ? ' danger' : ''}" type="button" data-action="status" data-id="${esc(order.id)}" data-status="${esc(s)}">${esc(action.label)}</button>`;
  };
  return `<section class="card next-card">
    <h2>Next step</h2>
    <p>${esc(say)}</p>
    ${forward ? `<div class="row">${button(forward, 'btn primary big')}${order.status === 'packed' && shippo ? '<a class="btn big" href="https://apps.goshippo.com/orders" target="_blank" rel="noopener">Open Shippo ↗</a>' : ''}</div>` : ''}
    ${others.length ? `<div class="more row"><span class="muted small">Other actions:</span>${others.map((s) => button(s, 'textlink')).join('')}</div>` : ''}
    ${order.stripe_session ? '<p class="hint">Refunds are issued in your <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener">Stripe dashboard</a> first.</p>' : ''}
  </section>`;
}

function emailRow(order, kind, name) {
  const sent = order.emails?.[kind];
  const base = `${API}/orders/${encodeURIComponent(order.id)}/email/${kind}`;
  const blocked = !order.customer?.email ? 'No customer email' : kind === 'shipping' && !order.tracking ? 'Waiting for a tracking number' : '';
  return `<div class="email-row">
    <div><strong>${esc(name)}</strong>
      <div class="muted small">${sent?.at ? `Sent ${esc(when(sent.at))}` : 'Not sent'}${blocked ? ` · ${esc(blocked)}` : ''}</div>
      <div class="small"><a href="${base}?lang=en" target="_blank" rel="noopener">Preview English</a> · <a href="${base}?lang=es" target="_blank" rel="noopener">Spanish</a></div>
    </div>
    <button class="btn tiny" type="button" data-action="email" data-id="${esc(order.id)}" data-kind="${kind}" data-sent="${sent?.at ? '1' : ''}" ${blocked ? 'disabled' : ''}>${sent?.at ? 'Send again' : 'Send now'}</button>
  </div>`;
}

async function renderOrder(id) {
  const order = await api(`/orders/${encodeURIComponent(id)}`);
  document.title = `Order #${order.number} · 90:00 Archive`;
  const c = order.customer || {};
  const a = c.address || {};
  const next = overview.nextStatus[order.status] ?? [];
  const reached = STEPS.findIndex(([s]) => s === order.status);
  const link = trackingUrl(order.carrier, order.tracking);
  view.innerHTML = `
    <a class="back" href="/admin" data-link>← All orders</a>
    <div class="page-head">
      <div><h1>Order #${esc(order.number)} ${statusBadge(order)}</h1><p class="muted small">${esc(when(order.created_at))} · ${esc(order.channel)}</p></div>
    </div>
    ${reached >= 0 ? `<ol class="steps">${STEPS.map(([, label], i) => `<li class="${i < reached ? 'done' : i === reached ? 'now' : ''}">${label}</li>`).join('')}</ol>` : ''}
    ${order.needs_review ? `<div class="notice alert"><strong>This order needs a look.</strong> ${esc([...order.events].reverse().find((e) => /review|ran out|refund|chargeback|charged/i.test(e.message))?.message ?? 'See the history below.')}
      <div class="row" style="margin-top:8px"><button class="btn tiny" type="button" data-action="reviewed" data-id="${esc(order.id)}">It’s sorted</button></div></div>` : ''}
    <div class="detail">
      <div class="stack">
        <section class="card">
          <h2>What to pack</h2>
          ${order.items.map((i) => `<div class="item">
            ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="">` : '<div class="thumb"></div>'}
            <div><strong>${esc(i.title)}</strong><div class="muted small">${esc([i.team, i.player && `${i.player} #${i.number}`].filter(Boolean).join(' · '))}</div>
              <div class="pack">${i.section === 'women' ? '<strong>Women’s</strong> size' : 'Size'} <span class="size">${esc(i.size)}</span> × <strong>${esc(i.qty)}</strong></div></div>
            <div>${esc(money(i.unitCents * i.qty))}</div>
          </div>`).join('')}
          <div class="totals">
            <div><span class="muted">Subtotal</span><span>${esc(money(order.subtotal_cents))}</span></div>
            <div><span class="muted">Shipping</span><span>${order.shipping_cents ? esc(money(order.shipping_cents)) : 'Free'}</span></div>
            <div class="total"><span>Total paid</span><span>${esc(money(order.total_cents))}</span></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Shipping</h2>${link ? `<a class="small" href="${esc(link)}" target="_blank" rel="noopener">Track package ↗</a>` : ''}</div>
          ${overview.shippo?.enabled ? `<p class="hint" style="margin:-8px 0 14px">${order.shippo_order
    ? 'This order is in Shippo. Buying its label there fills in the tracking below and emails the customer.'
    : 'This order isn’t in Shippo.'} <button class="textlink" type="button" data-action="shippo" data-id="${esc(order.id)}" data-sent="${order.shippo_order ? '1' : ''}">${order.shippo_order ? 'Send again' : 'Send to Shippo'}</button></p>` : ''}
          <form data-form="order" data-id="${esc(order.id)}">
            <div class="grid-2">
              <div class="field"><label for="carrier">Carrier</label><input id="carrier" name="carrier" type="text" value="${esc(order.carrier)}" placeholder="USPS"></div>
              <div class="field"><label for="tracking">Tracking number</label><input id="tracking" name="tracking" type="text" value="${esc(order.tracking)}"></div>
            </div>
            <div class="field"><label for="note">Private note</label><textarea id="note" name="note" placeholder="Only you see this">${esc(order.note)}</textarea></div>
            <button class="btn" type="submit">Save</button>
            <p class="hint">Saving a tracking number on a shipped order emails it to the customer.</p>
          </form>
        </section>
        <section class="card">
          <details>
            <summary><h2>History</h2> <span class="muted small">(${esc(order.events.length)})</span></summary>
            <ul class="timeline">${[...order.events].reverse().map((e) => `<li>${esc(e.message)}<div class="muted small">${esc(when(e.at))}</div></li>`).join('')}</ul>
          </details>
        </section>
      </div>
      <div class="stack side">
        ${nextStepCard(order, next)}
        <section class="card">
          <h2>Ship to</h2>
          <address>
            <strong>${esc(c.name || 'No name yet')}</strong><br>
            ${a.line1 ? `${esc(a.line1)}<br>` : ''}${a.line2 ? `${esc(a.line2)}<br>` : ''}
            ${esc([[a.city, a.state].filter(Boolean).join(', '), a.postal_code].filter(Boolean).join(' '))}${a.country ? `<br>${esc(a.country)}` : ''}
          </address>
          ${c.email ? `<p class="small" style="margin-top:8px"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
          ${c.phone ? `<p class="small">${esc(c.phone)}</p>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><h2>Emails to the customer</h2><span class="muted small">${order.lang === 'es' ? 'In Spanish' : 'In English'}</span></div>
          ${overview.email?.enabled ? '' : '<p class="notice">Email isn’t set up yet, so nothing is sent. <a href="/admin/settings" data-link>What’s missing</a></p>'}
          ${emailRow(order, 'confirmation', 'Order confirmation')}
          ${emailRow(order, 'shipping', 'Shipped, with tracking')}
        </section>
      </div>
    </div>`;
}

let manualJerseys = [];

async function renderManualOrder() {
  document.title = 'Add manual order · 90:00 Archive';
  manualJerseys = (await api('/jerseys')).filter((j) => j.active);
  view.innerHTML = `
    <a class="back" href="/admin" data-link>← All orders</a>
    <div class="page-head"><div><h1>Add manual order</h1>
      <p class="muted">For sales outside the website, like Instagram or in person. Saving takes the jerseys out of stock but doesn’t charge anyone, so collect payment first.</p></div></div>
    <form data-form="manual">
      <section class="card">
        <h2>Jerseys</h2>
        <div id="manual-lines"></div>
        <button class="btn tiny" type="button" data-action="add-line">+ Another jersey</button>
      </section>
      <section class="card">
        <h2>Customer</h2>
        <div class="grid-2">
          <div class="field"><label for="m-name">Name</label><input id="m-name" name="name" type="text" required></div>
          <div class="field"><label for="m-channel">Sold through</label><input id="m-channel" name="channel" type="text" value="Instagram"></div>
          <div class="field"><label for="m-email">Email</label><input id="m-email" name="email" type="email"><p class="hint">Needed to send them emails.</p></div>
          <div class="field"><label for="m-phone">Phone</label><input id="m-phone" name="phone" type="text"></div>
        </div>
        <h3 style="margin:6px 0 10px">Shipping address</h3>
        <p class="hint" style="margin:-6px 0 12px">Leave blank for in-person sales. With an address, the order goes to Shippo.</p>
        <div class="field"><label for="m-line1">Street address</label><input id="m-line1" name="line1" type="text"></div>
        <div class="field"><label for="m-line2">Apartment, suite (optional)</label><input id="m-line2" name="line2" type="text"></div>
        <div class="grid-3">
          <div class="field"><label for="m-city">City</label><input id="m-city" name="city" type="text"></div>
          <div class="field"><label for="m-state">State</label><input id="m-state" name="state" type="text"></div>
          <div class="field"><label for="m-zip">ZIP code</label><input id="m-zip" name="postal_code" type="text"></div>
        </div>
        <div class="grid-3">
          <div class="field"><label for="m-country">Country code</label><input id="m-country" name="country" type="text" value="US" maxlength="2"></div>
          <div class="field"><label for="m-ship">Shipping charged ($)</label><input id="m-ship" name="shippingUsd" type="number" min="0" step="0.01" value="0"></div>
          <div class="field"><label for="m-lang">Email language</label><select id="m-lang" name="lang"><option value="en">English</option><option value="es">Spanish</option></select></div>
        </div>
        <div class="field"><label for="m-note">Private note</label><textarea id="m-note" name="note" placeholder="Only you see this"></textarea></div>
      </section>
      <div class="savebar"><button class="btn primary big" type="submit">Save order</button><span class="form-error" role="alert"></span></div>
    </form>`;
  addManualLine();
}

function addManualLine() {
  const box = document.getElementById('manual-lines');
  const row = document.createElement('div');
  row.className = 'line-item';
  row.innerHTML = `
    <div><label>Jersey</label><select data-role="jersey">${manualJerseys.map((j) => `<option value="${esc(j.slug)}">${esc(j.title)} (${esc(j.team)}${j.section === 'women' ? ', women’s' : ''})</option>`).join('')}</select></div>
    <div><label>Size</label><select data-role="size"></select></div>
    <div><label>Qty</label><input data-role="qty" type="number" min="1" value="1"></div>
    <button class="btn tiny" type="button" data-action="remove-line">Remove</button>`;
  box.append(row);
  fillSizes(row);
}

function fillSizes(row) {
  const jersey = manualJerseys.find((j) => j.slug === row.querySelector('[data-role="jersey"]').value);
  row.querySelector('[data-role="size"]').innerHTML = Object.entries(jersey?.stock ?? {})
    .map(([size, qty]) => `<option value="${esc(size)}" ${qty ? '' : 'disabled'}>${esc(size)} (${esc(qty)} left)</option>`).join('');
}

// --- Jerseys ---
let jerseyCache = [];
const finalPrice = (j) => Math.round((j.priceUsd - (j.discountUsd || 0)) * 100);

async function renderJerseys() {
  document.title = 'Jerseys · 90:00 Archive';
  jerseyCache = await api('/jerseys');
  const total = jerseyCache.reduce((sum, j) => sum + Object.values(j.stock).reduce((s, q) => s + q, 0), 0);
  view.innerHTML = `
    <div class="page-head"><div><h1>Jerseys</h1><p class="muted small">${esc(jerseyCache.length)} jerseys · ${esc(total)} in stock. Change stock right here, or open a jersey to edit everything else.</p></div>
      <a class="btn primary" href="/admin/jerseys/new" data-link>+ Add jersey</a></div>
    <div class="list jersey-list">${jerseyCache.map((j, i) => `<div class="jersey-row${j.active ? '' : ' hidden'}">
      ${j.images?.[0] ? `<img class="thumb" src="${esc(j.images[0])}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
      <div><a class="name" href="/admin/jerseys/${esc(j.slug)}" data-link>${esc(j.title)}</a>
        <div class="muted small">${esc([j.team, j.player && `${j.player} #${j.number}`].filter(Boolean).join(' · '))}</div>
        <div class="small">${j.section === 'women' ? 'Women’s' : 'Men’s'} · <strong>${esc(money(finalPrice(j)))}</strong>${j.active ? '' : ' · <span class="badge">Hidden from shop</span>'}</div></div>
      <form class="quick-stock" data-form="stock" data-slug="${esc(j.slug)}">
        ${Object.entries(j.stock).map(([s, q]) => `<div><label for="qs-${esc(j.slug)}-${esc(s)}">${esc(s)}</label>
          <input id="qs-${esc(j.slug)}-${esc(s)}" data-size="${esc(s)}" type="number" min="0" step="1" value="${esc(q)}" class="${q ? '' : 'out'}"></div>`).join('') || '<span class="muted small">No sizes yet</span>'}
        <button class="btn tiny primary save-stock" type="submit">Save stock</button>
      </form>
      <div class="row">
        <button class="btn tiny" type="button" data-action="move" data-slug="${esc(j.slug)}" data-direction="up" aria-label="Move ${esc(j.title)} up" title="Show earlier in the shop" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn tiny" type="button" data-action="move" data-slug="${esc(j.slug)}" data-direction="down" aria-label="Move ${esc(j.title)} down" title="Show later in the shop" ${i === jerseyCache.length - 1 ? 'disabled' : ''}>↓</button>
        <a class="btn tiny" href="/admin/jerseys/${esc(j.slug)}" data-link>Edit</a>
      </div>
    </div>`).join('')}</div>`;
}

const field = (id, label, value = '', { type = 'text', hint = '', attrs = '' } = {}) => `<div class="field"><label for="${id}">${esc(label)}</label>
  <input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;
const area = (id, label, value = '', { hint = '' } = {}) => `<div class="field"><label for="${id}">${esc(label)}</label>
  <textarea id="${id}" name="${id}">${esc(value)}</textarea>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;
const both = (id, label, value, options) => `<div class="grid-2">${field(`${id}_en`, `${label} (English)`, value?.en, options)}${field(`${id}_es`, `${label} (Spanish)`, value?.es, options)}</div>`;
const bothArea = (id, label, value, options) => `<div class="grid-2">${area(`${id}_en`, `${label} (English)`, value?.en, options)}${area(`${id}_es`, `${label} (Spanish)`, value?.es, options)}</div>`;

let draft = null;

function renderImages() {
  const box = document.getElementById('images');
  box.innerHTML = `${draft.images.map((src, i) => `<div class="image-tile">
      ${i === 0 ? '<span class="first">Main</span>' : ''}
      <img src="${esc(src)}" alt="Photo ${i + 1}">
      <div class="row">
        <button class="btn tiny" type="button" data-action="image-left" data-index="${i}" aria-label="Move photo ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>←</button>
        <button class="btn tiny danger" type="button" data-action="image-remove" data-index="${i}" aria-label="Remove photo ${i + 1}">✕</button>
        <button class="btn tiny" type="button" data-action="image-right" data-index="${i}" aria-label="Move photo ${i + 1} later" ${i === draft.images.length - 1 ? 'disabled' : ''}>→</button>
      </div>
    </div>`).join('')}
    <label class="upload">+ Add photos<br><span class="hint">JPG, PNG or WebP, up to 8 MB</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="gallery"></label>`;
}

function renderHistoryPhoto() {
  const box = document.getElementById('history-photo');
  const src = draft.history?.photo?.src;
  box.innerHTML = `${src ? `<div class="image-tile" style="max-width:180px"><img src="${esc(src)}" alt="History photo"><div class="row"><button class="btn tiny" type="button" data-action="history-photo-remove">Remove</button></div></div>` : ''}
    <label class="upload" style="max-width:260px;margin-top:8px">${src ? 'Replace photo' : '+ Add history photo'}
      <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="history"></label>`;
}

function updatePays(form) {
  const box = form.querySelector('#pays');
  if (!box) return;
  const list = Number(form.elements.priceUsd.value) || 0;
  const off = Number(form.elements.discountUsd.value) || 0;
  box.innerHTML = `Customers pay <strong>${esc(money(Math.round((list - off) * 100)))}</strong>${off ? ` <span class="muted">(${esc(money(Math.round(list * 100)))} with ${esc(money(Math.round(off * 100)))} off)</span>` : ''}`;
}

async function renderJerseyEditor(slug) {
  const isNew = slug === 'new';
  let j = {
    section: 'men', title: '', team: '', player: '', number: '', priceUsd: 90, discountUsd: 10, active: true,
    stock: { M: 0, L: 0, XL: 0 }, notes: { en: [], es: [] }, images: [], history: null,
  };
  if (!isNew) {
    const all = await api('/jerseys');
    j = all.find((x) => x.slug === slug);
    if (!j) {
      view.innerHTML = '<p class="empty card">Jersey not found.</p>';
      return;
    }
  }
  draft = { images: [...(j.images ?? [])], history: j.history ? { photo: j.history.photo ?? null } : { photo: null }, extraSizes: [] };
  document.title = `${isNew ? 'Add jersey' : j.title} · 90:00 Archive`;
  const h = j.history ?? {};
  const sizes = [...new Set([...STANDARD_SIZES, ...Object.keys(j.stock)])];
  const stats = [0, 1, 2].map((i) => h.stats?.[i] ?? {});
  const ph = h.photo ?? {};
  const hasChapter = Boolean(h.headline?.en || h.story?.en?.length || h.years);
  view.innerHTML = `
    <a class="back" href="/admin/jerseys" data-link>← All jerseys</a>
    <div class="page-head"><h1>${isNew ? 'Add jersey' : esc(j.title)}</h1>${isNew ? '' : `<a class="small" href="/shop/${esc(j.slug)}" target="_blank" rel="noopener">View in shop ↗</a>`}</div>
    <form data-form="jersey" data-slug="${esc(isNew ? '' : j.slug)}" novalidate>
      <section class="card">
        <h2>Basics</h2>
        <div class="grid-2">
          ${field('team', 'Team', j.team, { attrs: 'required' })}
          ${field('title', 'Collection name', j.title, { hint: 'For example: El 22 Rossonero. Leave blank to use the team.' })}
          ${field('player', 'Player', j.player ?? '', { hint: 'Leave blank if there’s no name on the back.' })}
          ${field('number', 'Number', j.number ?? '', { type: 'number', attrs: 'min="0" max="999"' })}
        </div>
        <div class="grid-3">
          ${field('priceUsd', 'List price ($)', j.priceUsd, { type: 'number', attrs: 'min="0" step="0.01" required' })}
          ${field('discountUsd', 'Discount ($)', j.discountUsd ?? 0, { type: 'number', attrs: 'min="0" step="0.01"' })}
          <div class="field"><label for="section">Section</label>
            <select id="section" name="section"><option value="men" ${j.section !== 'women' ? 'selected' : ''}>Men’s</option><option value="women" ${j.section === 'women' ? 'selected' : ''}>Women’s</option></select></div>
        </div>
        <p class="pays field" id="pays"></p>
        <label class="check"><input type="checkbox" name="active" ${j.active !== false ? 'checked' : ''}> Show in the shop</label>
      </section>
      <section class="card">
        <h2>Stock</h2>
        <p class="hint">How many of each size you have. Leave a size blank if this jersey doesn’t come in it, or enter 0 to show it sold out.</p>
        <div class="stock-editor">${sizes.map((size) => `<div><label for="stock_${esc(size)}">${esc(size)}</label>
          <input id="stock_${esc(size)}" data-size="${esc(size)}" type="number" min="0" step="1" inputmode="numeric" value="${size in j.stock ? esc(j.stock[size]) : ''}"></div>`).join('')}</div>
      </section>
      <section class="card">
        <h2>Photos</h2>
        <p class="hint">The first photo shows in the shop. The second appears when someone hovers over it.</p>
        <div class="images" id="images"></div>
      </section>
      <section class="card">
        <h2>Details</h2>
        ${bothArea('notes', 'One per line', { en: (j.notes?.en ?? []).join('\n'), es: (j.notes?.es ?? []).join('\n') }, { hint: 'For example: Long sleeve' })}
      </section>
      <section class="card">
        <details>
          <summary><h2>Archive chapter</h2> <span class="muted small">${hasChapter ? '· filled in' : '· optional'}</span></summary>
          <p class="hint" style="margin:8px 0 14px">The jersey’s story page in The Archive. Any Spanish you leave blank shows in English.</p>
          ${field('years', 'Era', h.years ?? '', { hint: 'For example: 2002–04' })}
          ${both('headline', 'Headline', h.headline)}
          ${bothArea('story', 'Story', { en: (h.story?.en ?? []).join('\n\n'), es: (h.story?.es ?? []).join('\n\n') }, { hint: 'Leave a blank line between paragraphs.' })}
          <h3 style="margin:18px 0 10px">The moment</h3>
          ${both('moment_date', 'Date and place', h.moment?.date)}
          ${both('moment_title', 'Title', h.moment?.title)}
          ${bothArea('moment_text', 'What happened', h.moment?.text)}
          ${field('moment_query', 'YouTube search', h.moment?.query ?? '', { hint: 'What the “Watch highlights” link searches for.' })}
          <h3 style="margin:18px 0 10px">Stats</h3>
          ${stats.map((s, i) => `<div class="grid-3">${field(`stat${i}_value`, `Stat ${i + 1}`, s.value ?? '')}${field(`stat${i}_en`, 'Label (English)', s.label?.en ?? '')}${field(`stat${i}_es`, 'Label (Spanish)', s.label?.es ?? '')}</div>`).join('')}
          <h3 style="margin:18px 0 10px">History photo</h3>
          <p class="hint" style="margin-bottom:10px">Only use photos you have the rights to, and credit them below.</p>
          <div id="history-photo" class="field"></div>
          ${both('photo_caption', 'Caption', ph.caption)}
          ${both('photo_alt', 'Description for screen readers', ph.alt)}
          <div class="grid-3">
            ${field('photo_credit', 'Photographer', ph.credit ?? '')}
            ${field('photo_license', 'License', ph.license ?? '', { hint: 'For example: CC BY 2.0' })}
            ${field('photo_licenseUrl', 'License link', ph.licenseUrl ?? '')}
          </div>
          ${field('photo_page', 'Photo source link', ph.page ?? '')}
          <input type="hidden" name="photo_w" value="${esc(ph.w ?? 1000)}"><input type="hidden" name="photo_h" value="${esc(ph.h ?? 1000)}">
          <h3 style="margin:18px 0 10px">Sources</h3>
          ${area('sources', 'One per line: name, then | and the link', (h.sources ?? []).map((s) => `${s.label} | ${s.url}`).join('\n'))}
        </details>
      </section>
      <div class="savebar"><button class="btn primary big" type="submit">${isNew ? 'Add jersey' : 'Save changes'}</button><span class="form-error" role="alert"></span></div>
    </form>`;
  renderImages();
  renderHistoryPhoto();
  updatePays(view.querySelector('form[data-form="jersey"]'));
  dirty = false;
}

function readJersey(form) {
  const v = (name) => form.elements[name]?.value ?? '';
  const pair = (name) => ({ en: v(`${name}_en`), es: v(`${name}_es`) });
  const stock = {};
  form.querySelectorAll('[data-size]').forEach((input) => {
    if (input.value !== '') stock[input.dataset.size] = Number(input.value);
  });
  return {
    section: v('section'),
    title: v('title'),
    team: v('team'),
    player: v('player'),
    number: v('number'),
    priceUsd: v('priceUsd'),
    discountUsd: v('discountUsd') || 0,
    active: form.elements.active.checked,
    stock,
    notes: { en: lines(v('notes_en')), es: lines(v('notes_es')) },
    images: draft.images,
    history: {
      years: v('years'),
      headline: pair('headline'),
      story: { en: paragraphs(v('story_en')), es: paragraphs(v('story_es')) },
      moment: { date: pair('moment_date'), title: pair('moment_title'), text: pair('moment_text'), query: v('moment_query') },
      stats: [0, 1, 2].map((i) => ({ value: v(`stat${i}_value`), label: { en: v(`stat${i}_en`), es: v(`stat${i}_es`) } })),
      photo: draft.history.photo?.src ? {
        src: draft.history.photo.src,
        w: v('photo_w'),
        h: v('photo_h'),
        caption: pair('photo_caption'),
        alt: pair('photo_alt'),
        credit: v('photo_credit'),
        license: v('photo_license'),
        licenseUrl: v('photo_licenseUrl'),
        page: v('photo_page'),
      } : null,
      sources: lines(v('sources')).map((line) => {
        const [label, url] = line.split('|').map((x) => x.trim());
        return { label, url };
      }),
    },
  };
}

// --- Settings ---
function statusBlock(title, on, onText, offText, missing) {
  return `<section class="card">
    <div class="status-line"><span class="dot${on ? ' on' : ''}"></span><h2>${esc(title)}</h2></div>
    <p style="margin-top:8px">${on ? onText : offText}</p>
    ${!on && missing?.length ? `<ul class="small muted" style="margin:8px 0 0;padding-left:20px">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

async function renderSettings() {
  document.title = 'Settings · 90:00 Archive';
  const s = overview.settings;
  const c = overview.checkout;
  const e = overview.email;
  const sh = overview.shippo ?? {};
  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <section class="card">
      <h2>Shipping price</h2>
      <form data-form="settings">
        <div class="grid-2">
          ${field('shippingUsd', 'Shipping for one jersey ($)', s.shippingCents == null ? '' : s.shippingCents / 100, { type: 'number', attrs: 'min="0" step="0.01"', hint: 'Orders of 2 or more jerseys ship free.' })}
          ${field('countries', 'Countries you ship to', s.countries.join(', '), { hint: 'Two-letter codes, separated by commas. For example: US, GT' })}
        </div>
        <div class="row"><button class="btn primary" type="submit">Save</button><span class="form-error" role="alert"></span></div>
      </form>
    </section>
    <h2 style="margin:26px 0 12px">Connections</h2>
    ${statusBlock('Online checkout (Stripe)', c.enabled,
    `On, in Stripe <strong>${esc(c.mode)}</strong> mode.`,
    'Off. Customers can browse and fill a cart but can’t pay yet. Still needed:', c.missing)}
    ${statusBlock('Customer emails (Resend)', e.enabled,
    `On, sent from <strong>${esc(e.from)}</strong>${e.replyTo ? `, with replies going to <strong>${esc(e.replyTo)}</strong>` : ''}.`,
    'Off. Customers won’t get order confirmations or tracking numbers. Still needed:', e.missing)}
    ${statusBlock('Shipping labels (Shippo)', sh.enabled,
    `Connected in <strong>${esc(sh.mode)}</strong> mode. Paid orders go to Shippo on their own, and buying a label there marks the order shipped and emails the customer from this site.`,
    'Not connected. Type tracking numbers in by hand on each order. Still needed:', sh.missing)}`;
}

// --- Routing ---
async function route() {
  try {
    const session = await fetch(`${API}/session`).then((r) => r.json());
    if (!session.signedIn) {
      overview = null;
      renderTop(false);
      renderLogin(session);
      return;
    }
    if (!session.database) {
      renderTop(false);
      view.innerHTML = '<section class="login card"><h1>Database not connected</h1><p class="muted">Add a DATABASE_URL setting on Render, then reload this page.</p></section>';
      return;
    }
    overview = await api('/overview');
    renderTop(true);
    const path = location.pathname.replace(/\/+$/, '');
    const order = path.match(/^\/admin\/orders\/([^/]+)$/);
    const jersey = path.match(/^\/admin\/jerseys\/([^/]+)$/);
    if (path === '/admin/orders/new') await renderManualOrder();
    else if (order) await renderOrder(decodeURIComponent(order[1]));
    else if (path === '/admin/jerseys') await renderJerseys();
    else if (jersey) await renderJerseyEditor(decodeURIComponent(jersey[1]));
    else if (path === '/admin/settings') await renderSettings();
    else await renderOrders();
    window.scrollTo(0, 0);
  } catch (error) {
    view.innerHTML = `<p class="empty card">${esc(error.message)}</p>`;
  }
}

async function upload(files) {
  const paths = [];
  for (const file of files) {
    paths.push((await api('/media', { method: 'POST', raw: file })).path);
  }
  return paths;
}

// --- Events ---
document.addEventListener('click', async (event) => {
  const link = event.target.closest('a[data-link]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    go(link.getAttribute('href'));
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, id, slug, index } = control.dataset;
  const i = Number(index);
  try {
    if (action === 'logout') {
      await api('/logout', { method: 'POST' });
      history.pushState(null, '', '/admin');
      await route();
    } else if (action === 'status') {
      const confirmText = ORDER_ACTIONS[control.dataset.status]?.confirm;
      if (confirmText && !window.confirm(confirmText)) return;
      const updated = await api(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: control.dataset.status } });
      toast(updated.status === 'shipped' && !updated.tracking ? 'Marked as shipped. Add the tracking number to email it to the customer.' : `Order is now ${STATUS[updated.status]?.label.toLowerCase() ?? updated.status}`);
      await route();
    } else if (action === 'email') {
      if (control.dataset.sent && !window.confirm('This email was already sent. Send it again?')) return;
      control.disabled = true;
      const result = await api(`/orders/${encodeURIComponent(id)}/email`, { method: 'POST', body: { kind: control.dataset.kind } });
      toast(result.sent ? 'Email sent' : `Not sent: ${result.reason}`, !result.sent);
      await route();
    } else if (action === 'shippo') {
      if (control.dataset.sent && !window.confirm('This order is already in Shippo. Send a second copy?')) return;
      control.disabled = true;
      const result = await api(`/orders/${encodeURIComponent(id)}/shippo`, { method: 'POST' });
      toast(result.sent ? 'Sent to Shippo' : `Not sent: ${result.reason}`, !result.sent);
      await route();
    } else if (action === 'reviewed') {
      await api(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { needsReview: false } });
      await route();
    } else if (action === 'move') {
      await api(`/jerseys/${encodeURIComponent(slug)}/move`, { method: 'POST', body: { direction: control.dataset.direction } });
      await route();
    } else if (action === 'add-line') {
      addManualLine();
    } else if (action === 'remove-line') {
      if (document.querySelectorAll('.line-item').length > 1) control.closest('.line-item').remove();
    } else if (action === 'image-remove') {
      draft.images.splice(i, 1);
      dirty = true;
      renderImages();
    } else if (action === 'image-left' || action === 'image-right') {
      const to = action === 'image-left' ? i - 1 : i + 1;
      [draft.images[i], draft.images[to]] = [draft.images[to], draft.images[i]];
      dirty = true;
      renderImages();
    } else if (action === 'history-photo-remove') {
      draft.history.photo = null;
      dirty = true;
      renderHistoryPhoto();
    }
  } catch (error) {
    toast(error.message, true);
  }
});

document.addEventListener('input', (event) => {
  const jerseyForm = event.target.closest('form[data-form="jersey"]');
  if (jerseyForm) {
    dirty = true;
    if (event.target.name === 'priceUsd' || event.target.name === 'discountUsd') updatePays(jerseyForm);
  }
  const quick = event.target.closest('form[data-form="stock"]');
  if (quick) {
    quick.classList.add('changed');
    event.target.classList.toggle('out', event.target.value === '0');
    dirty = true;
  }
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-role="jersey"]');
  if (select) fillSizes(select.closest('.line-item'));
  const input = event.target.closest('[data-upload]');
  if (!input || !input.files.length) return;
  try {
    toast('Uploading…');
    const paths = await upload(input.files);
    if (input.dataset.upload === 'gallery') {
      draft.images.push(...paths);
      renderImages();
    } else {
      draft.history.photo = { ...(draft.history.photo ?? {}), src: paths[0] };
      renderHistoryPhoto();
    }
    dirty = true;
    toast('Uploaded. Save to keep it.');
  } catch (error) {
    toast(error.message, true);
    input.value = '';
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const errorBox = form.querySelector('.form-error');
  if (errorBox) errorBox.textContent = '';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const kind = form.dataset.form;
    if (kind === 'login') {
      await api('/login', { method: 'POST', body: { password: form.elements.password.value } });
      await route();
    } else if (kind === 'order') {
      await api(`/orders/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: { carrier: form.elements.carrier.value, tracking: form.elements.tracking.value, note: form.elements.note.value } });
      toast('Saved');
      await route();
    } else if (kind === 'stock') {
      // Saves only the stock, keeping everything else about the jersey as it is.
      const jersey = jerseyCache.find((j) => j.slug === form.dataset.slug);
      const stock = {};
      for (const input of form.querySelectorAll('[data-size]')) {
        if (input.value === '' || !(Number(input.value) >= 0)) throw new Error(`Enter a number for size ${input.dataset.size}.`);
        stock[input.dataset.size] = Number(input.value);
      }
      await api(`/jerseys/${encodeURIComponent(jersey.slug)}`, { method: 'PUT', body: { ...jersey, stock } });
      jersey.stock = stock;
      form.classList.remove('changed');
      dirty = document.querySelector('.quick-stock.changed') !== null;
      toast(`Stock saved for ${jersey.title}`);
    } else if (kind === 'jersey') {
      const body = readJersey(form);
      const slug = form.dataset.slug;
      if (slug) {
        await api(`/jerseys/${encodeURIComponent(slug)}`, { method: 'PUT', body });
        dirty = false;
        toast('Saved');
        await route();
      } else {
        const created = await api('/jerseys', { method: 'POST', body });
        dirty = false;
        toast('Jersey added');
        go(`/admin/jerseys/${created.slug}`);
      }
    } else if (kind === 'settings') {
      await api('/settings', { method: 'PUT', body: {
        shippingUsd: form.elements.shippingUsd.value,
        countries: form.elements.countries.value.split(',').map((c) => c.trim()).filter(Boolean),
      } });
      toast('Saved');
      await route();
    } else if (kind === 'manual') {
      const v = (name) => form.elements[name].value;
      const created = await api('/orders', { method: 'POST', body: {
        channel: v('channel'),
        lang: v('lang'),
        note: v('note'),
        shippingUsd: v('shippingUsd') || 0,
        items: [...form.querySelectorAll('.line-item')].map((row) => ({
          slug: row.querySelector('[data-role="jersey"]').value,
          size: row.querySelector('[data-role="size"]').value,
          qty: Number(row.querySelector('[data-role="qty"]').value),
        })),
        customer: {
          name: v('name'), email: v('email'), phone: v('phone'),
          address: { line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), postal_code: v('postal_code'), country: v('country') },
        },
      } });
      toast(`Order #${created.number} added`);
      go(`/admin/orders/${created.id}`);
    }
  } catch (error) {
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

window.addEventListener('popstate', () => {
  dirty = false;
  route();
});

route();
