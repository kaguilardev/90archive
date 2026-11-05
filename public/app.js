const T = {
  en: {
    skip: 'Skip to content', shop: 'Shop', cart: 'Cart', otherLang: 'ES', otherLangName: 'Ver en español',
    intro: 'New retro-style soccer jerseys, chosen for the players, goals and eras people still remember.',
    shopAll: 'Shop the collection', viewAll: 'View all', collection: 'The collection',
    photoSoon: 'Photo coming soon', regular: 'Regular price', sale: 'Sale price', save: (n) => `$${n} off`,
    back: 'Back to the collection', size: 'Size', soldOutSize: 'sold out', add: 'Add to cart', soldOut: 'Sold out',
    pickSize: 'Please select a size.', added: 'Added to your cart.', viewCart: 'View cart',
    limit: 'You already have all our stock in this size.',
    details: 'Photos, measurements and full jersey details coming soon.',
    freeShip: 'Free shipping on 2 or more jerseys.',
    yourCart: 'Your cart', emptyCart: 'Your cart is empty.', remove: 'Remove',
    fewer: 'Remove one', more: 'Add one', subtotal: 'Subtotal', shipping: 'Shipping', shipFree: 'Free',
    shipLater: 'Calculated at checkout', oneMore: 'Add one more jersey for free shipping.',
    checkout: 'Checkout', checkoutSoon: 'Online checkout opens soon.',
    notFound: 'We couldn’t find that page.', loadError: 'The collection couldn’t load. Please refresh the page.',
    rights: 'All prices in USD.',
  },
  es: {
    skip: 'Ir al contenido', shop: 'Tienda', cart: 'Carrito', otherLang: 'EN', otherLangName: 'View in English',
    intro: 'Camisolas de fútbol nuevas de estilo retro, elegidas por los jugadores, los goles y las épocas que seguimos recordando.',
    shopAll: 'Ver la colección', viewAll: 'Ver todas', collection: 'La colección',
    photoSoon: 'Foto próximamente', regular: 'Precio regular', sale: 'Precio de oferta', save: (n) => `$${n} de descuento`,
    back: 'Volver a la colección', size: 'Talla', soldOutSize: 'agotada', add: 'Agregar al carrito', soldOut: 'Agotada',
    pickSize: 'Seleccioná una talla.', added: 'Agregada al carrito.', viewCart: 'Ver carrito',
    limit: 'Ya tenés todo nuestro inventario en esta talla.',
    details: 'Próximamente: fotos, medidas y todos los detalles de la camisola.',
    freeShip: 'Envío gratis en la compra de 2 camisolas o más.',
    yourCart: 'Tu carrito', emptyCart: 'Tu carrito está vacío.', remove: 'Quitar',
    fewer: 'Quitar una', more: 'Agregar una', subtotal: 'Subtotal', shipping: 'Envío', shipFree: 'Gratis',
    shipLater: 'Se calcula al pagar', oneMore: 'Agregá una camisola más para obtener envío gratis.',
    checkout: 'Pagar', checkoutSoon: 'El pago en línea abre pronto.',
    notFound: 'No encontramos esa página.', loadError: 'No se pudo cargar la colección. Recargá la página.',
    rights: 'Todos los precios en USD.',
  },
};

// The approved tagline has no official Spanish version yet, so it stays in English in both languages.
const TAGLINE = 'The match ends. The story lives on.';
const FREE_SHIPPING_MIN = 2;

const main = document.getElementById('main');
const header = document.getElementById('header');
const footer = document.getElementById('footer');

let products = [];
let loadFailed = false;
let lang = read('lang') || (navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en');
let cart = parseCart(read('cart'));

function read(key) {
  try { return localStorage.getItem(`90archive:${key}`); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(`90archive:${key}`, value); } catch { /* Works for this visit without storage. */ }
}

function parseCart(raw) {
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const t = () => T[lang];
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const finalPrice = (p) => p.priceUsd - p.discountUsd;
const bySlug = (slug) => products.find((p) => p.slug === slug);
const totalStock = (p) => Object.values(p.stock).reduce((a, b) => a + b, 0);
const cartCount = () => cart.reduce((sum, line) => sum + line.qty, 0);
const playerLine = (p) => (p.player ? `${p.player} #${p.number}` : '');

function saveCart() {
  write('cart', JSON.stringify(cart));
}

// Drops cart lines for products that no longer exist and caps quantities at current stock.
function reconcileCart() {
  cart = cart
    .filter((line) => bySlug(line.slug)?.stock[line.size] > 0 && line.qty > 0)
    .map((line) => ({ ...line, qty: Math.min(line.qty, bySlug(line.slug).stock[line.size]) }));
  saveCart();
}

function jerseySvg(p) {
  const collar = '<path class="jersey-collar" d="M70 20 C80 40 120 40 130 20"/>';
  const shape = p.longSleeve
    ? 'M70 20 C80 32 120 32 130 20 L165 38 L188 180 L165 184 L148 85 L148 205 L52 205 L52 85 L35 184 L12 180 L35 38 Z'
    : 'M70 20 C80 32 120 32 130 20 L165 38 L190 85 L160 100 L148 78 L148 205 L52 205 L52 78 L40 100 L10 85 L35 38 Z';
  const print = p.number
    ? `<text class="jersey-name" x="100" y="78">${esc(p.player.toUpperCase())}</text>
       <text class="jersey-number" x="100" y="140">${esc(p.number)}</text>`
    : '<text class="jersey-mark" x="100" y="118">90:00</text>';
  return `<svg viewBox="0 0 200 220" aria-hidden="true"><path class="jersey-shape" d="${shape}"/>${collar}${print}</svg>`;
}

function visual(p) {
  if (p.images[0]) return `<div class="plate"><img src="${esc(p.images[0])}" alt="${esc(p.team)}"></div>`;
  return `<div class="plate">${jerseySvg(p)}<span class="pending">${esc(t().photoSoon)}</span></div>`;
}

function priceLine(p) {
  return `<div class="price-line">
    <span class="visually-hidden">${esc(t().regular)}:</span><span class="was">$${p.priceUsd}</span>
    <span class="visually-hidden">${esc(t().sale)}:</span><span class="now">$${finalPrice(p)}</span>
  </div>`;
}

function card(p, headingTag = 'h3') {
  const soldOut = totalStock(p) === 0;
  const player = playerLine(p);
  return `<a class="card" href="/shop/${esc(p.slug)}" data-link>
    ${visual(p)}
    <${headingTag}>${esc(p.team)}</${headingTag}>
    ${player ? `<div class="meta">${esc(player)}</div>` : ''}
    ${soldOut ? `<div class="meta">${esc(t().soldOut)}</div>` : priceLine(p)}
  </a>`;
}

function renderChrome() {
  document.documentElement.lang = lang;
  document.querySelector('.skip').textContent = t().skip;
  const count = cartCount();
  header.innerHTML = `
    <nav class="nav-left"><a class="nav-link" href="/shop" data-link>${esc(t().shop)}</a></nav>
    <a class="wordmark" href="/" data-link aria-label="90:00 Archive"><b>90:00</b><span>ARCHIVE</span></a>
    <div class="nav-right">
      <button class="lang" type="button" data-action="lang" aria-label="${esc(t().otherLangName)}">${esc(t().otherLang)}</button>
      <a class="nav-link" href="/cart" data-link>${esc(t().cart)} (${count})</a>
    </div>`;
  footer.innerHTML = `<em>${esc(TAGLINE)}</em><span>© ${new Date().getFullYear()} 90:00 Archive · ${esc(t().rights)}</span>`;
}

function renderHome() {
  document.title = '90:00 Archive';
  main.innerHTML = `
    <section class="hero">
      <h1><img src="/assets/logo.webp" alt="90:00 Archive" width="1254" height="627"></h1>
      <p class="tagline" lang="en">${esc(TAGLINE)}</p>
      <p class="intro">${esc(t().intro)}</p>
      <a class="button" href="/shop" data-link>${esc(t().shopAll)}</a>
    </section>
    <section class="section">
      <div class="section-head"><h2>${esc(t().collection)}</h2><a href="/shop" data-link>${esc(t().viewAll)}</a></div>
      <div class="grid">${products.slice(0, 3).map((p) => card(p)).join('')}</div>
    </section>`;
}

function renderShop() {
  document.title = `${t().collection} · 90:00 Archive`;
  main.innerHTML = `<section class="section" style="border-top:0">
    <div class="section-head"><h1>${esc(t().collection)}</h1></div>
    <div class="grid">${products.map((p) => card(p, 'h2')).join('')}</div>
  </section>`;
}

function renderProduct(p) {
  document.title = `${[p.team, p.player].filter(Boolean).join(' ')} · 90:00 Archive`;
  const available = totalStock(p) > 0;
  const sizes = Object.entries(p.stock).map(([size, qty]) => `
    <label class="size">
      <input type="radio" name="size" value="${esc(size)}" ${qty === 0 ? 'disabled' : ''}>
      <span>${esc(size)}${qty === 0 ? `<span class="visually-hidden"> (${esc(t().soldOutSize)})</span>` : ''}</span>
    </label>`).join('');
  main.innerHTML = `<article class="product">
    <div>${visual(p)}</div>
    <div>
      <a class="back" href="/shop" data-link>← ${esc(t().back)}</a>
      <h1>${esc(p.team)}</h1>
      ${p.player ? `<p class="player">${esc(playerLine(p))}</p>` : ''}
      ${priceLine(p)}
      <p class="saving">${esc(t().save(p.discountUsd))}</p>
      ${p.notes[lang].length ? `<ul class="notes">${p.notes[lang].map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <form data-add="${esc(p.slug)}" novalidate>
        <fieldset><legend>${esc(t().size)}</legend><div class="sizes">${sizes}</div></fieldset>
        <button class="button" type="submit" ${available ? '' : 'disabled'}>${esc(available ? t().add : t().soldOut)}</button>
        <p class="status" role="status"></p>
      </form>
      <p class="fine">${esc(t().freeShip)}<br>${esc(t().details)}</p>
    </div>
  </article>`;
}

function renderCart() {
  document.title = `${t().yourCart} · 90:00 Archive`;
  if (!cart.length) {
    main.innerHTML = `<section class="empty"><h1>${esc(t().emptyCart)}</h1>
      <a class="button" href="/shop" data-link>${esc(t().shopAll)}</a></section>`;
    return;
  }
  const lines = cart.map((line) => {
    const p = bySlug(line.slug);
    const key = `${esc(line.slug)}|${esc(line.size)}`;
    return `<div class="line">
      ${visual(p)}
      <div>
        <h2>${esc(p.team)}</h2>
        <div class="meta">${esc([playerLine(p), `${t().size} ${line.size}`].filter(Boolean).join(' · '))}</div>
        <div class="line-actions">
          <span class="stepper">
            <button type="button" data-action="dec" data-key="${key}" aria-label="${esc(t().fewer)}">−</button>
            <output>${line.qty}</output>
            <button type="button" data-action="inc" data-key="${key}" aria-label="${esc(t().more)}" ${line.qty >= p.stock[line.size] ? 'disabled' : ''}>+</button>
          </span>
          <button class="remove" type="button" data-action="remove" data-key="${key}">${esc(t().remove)}</button>
        </div>
      </div>
      <div class="now">$${finalPrice(p) * line.qty}</div>
    </div>`;
  }).join('');
  const subtotal = cart.reduce((sum, line) => sum + finalPrice(bySlug(line.slug)) * line.qty, 0);
  const freeShipping = cartCount() >= FREE_SHIPPING_MIN;
  main.innerHTML = `<section class="cart">
    <h1>${esc(t().yourCart)}</h1>
    ${lines}
    <div class="summary">
      <div class="summary-row"><span>${esc(t().shipping)}</span><span>${esc(freeShipping ? t().shipFree : t().shipLater)}</span></div>
      <div class="summary-row total"><span>${esc(t().subtotal)}</span><span>$${subtotal}</span></div>
      ${freeShipping ? '' : `<p class="fine" style="text-align:left">${esc(t().oneMore)}</p>`}
      <button class="button" type="button" disabled>${esc(t().checkout)}</button>
      <p class="fine">${esc(t().checkoutSoon)}</p>
    </div>
  </section>`;
}

function renderMessage(message) {
  document.title = '90:00 Archive';
  main.innerHTML = `<section class="empty"><h1>${esc(message)}</h1>
    ${loadFailed ? '' : `<a class="button" href="/shop" data-link>${esc(t().shopAll)}</a>`}</section>`;
}

function route() {
  renderChrome();
  if (loadFailed) return renderMessage(t().loadError);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const productMatch = path.match(/^\/shop\/([a-z0-9-]+)$/);
  if (path === '/') return renderHome();
  if (path === '/shop') return renderShop();
  if (path === '/cart') return renderCart();
  if (productMatch && bySlug(productMatch[1])) return renderProduct(bySlug(productMatch[1]));
  return renderMessage(t().notFound);
}

function navigate(href) {
  history.pushState(null, '', href);
  route();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

function changeLine(action, key) {
  const [slug, size] = key.split('|');
  const line = cart.find((item) => item.slug === slug && item.size === size);
  if (!line) return;
  if (action === 'inc') line.qty = Math.min(line.qty + 1, bySlug(slug).stock[size]);
  if (action === 'dec') line.qty -= 1;
  if (action === 'remove') line.qty = 0;
  cart = cart.filter((item) => item.qty > 0);
  saveCart();
  route();
  const stillThere = main.querySelector(`[data-action="${action}"][data-key="${CSS.escape(key)}"]:not(:disabled)`);
  (stillThere || main).focus({ preventScroll: true });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    navigate(link.getAttribute('href'));
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  if (control.dataset.action === 'lang') {
    lang = lang === 'en' ? 'es' : 'en';
    write('lang', lang);
    route();
    header.querySelector('.lang').focus();
  } else {
    changeLine(control.dataset.action, control.dataset.key);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-add]');
  if (!form) return;
  event.preventDefault();
  const status = form.querySelector('.status');
  const size = new FormData(form).get('size');
  if (!size) {
    status.textContent = t().pickSize;
    return;
  }
  const slug = form.dataset.add;
  const line = cart.find((item) => item.slug === slug && item.size === size);
  if ((line?.qty || 0) >= bySlug(slug).stock[size]) {
    status.textContent = t().limit;
    return;
  }
  if (line) line.qty += 1;
  else cart.push({ slug, size, qty: 1 });
  saveCart();
  renderChrome();
  status.innerHTML = `${esc(t().added)} <a href="/cart" data-link>${esc(t().viewCart)}</a>`;
});

window.addEventListener('popstate', route);

try {
  const response = await fetch('/api/products');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  products = await response.json();
  reconcileCart();
} catch (error) {
  console.error(error);
  loadFailed = true;
}
route();
