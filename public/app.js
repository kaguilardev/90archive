const T = {
  en: {
    skip: 'Skip to content', shop: 'Shop', archive: 'The Archive', cart: 'Cart', otherLang: 'ES', otherLangName: 'Ver en español',
    intro: 'New retro-style soccer jerseys, chosen for the players, goals and eras people still remember.',
    shopAll: 'Shop the collection', viewAll: 'View all', collection: 'The collection',
    statement: ['We don’t sell jerseys.', 'We archive memories.'], regular: 'Regular price', sale: 'Sale price', save: (n) => `$${n} off`,
    back: 'Back to the collection', size: 'Size', soldOutSize: 'sold out', add: 'Add to cart', soldOut: 'Sold out',
    pickSize: 'Please select a size.', added: 'Added to your cart.', viewCart: 'View cart',
    limit: 'You already have all our stock in this size.',
    details: 'Measurements and fabric details coming soon.',
    freeShip: 'Free shipping on 2 or more jerseys.',
    yourCart: 'Your cart', emptyCart: 'Your cart is empty.', remove: 'Remove',
    fewer: 'Remove one', more: 'Add one', subtotal: 'Subtotal', shipping: 'Shipping', shipFree: 'Free',
    shipLater: 'Calculated at checkout', oneMore: 'Add one more jersey for free shipping.',
    checkout: 'Checkout', checkoutSoon: 'Online checkout opens soon.',
    notFound: 'We couldn’t find that page.', loadError: 'The collection couldn’t load. Please refresh the page.',
    rights: 'All prices in USD.',
    heroLead: 'A history book you can wear. Six jerseys, six chapters, and the nights that made them.',
    openArchive: 'Open the archive', chapter: 'Chapter', era: 'Era', theMoment: 'The moment',
    watch: 'Watch highlights on YouTube', sources: 'Sources', photo: 'Photo', readChapter: 'Read the chapter', shopJersey: 'Shop this jersey',
    archiveLead: 'Every jersey here belongs to a time, a player and a night people still talk about. This is the record, in order.',
    featureEyebrow: 'Why we are called 90:00',
    everyPiece: ['Every piece tells a story.', 'Every detail matters.', 'Every moment, eternal.'],
    retroNote: 'A new jersey inspired by this history. It is not a shirt worn in these matches.',
  },
  es: {
    skip: 'Ir al contenido', shop: 'Tienda', archive: 'El Archivo', cart: 'Carrito', otherLang: 'EN', otherLangName: 'View in English',
    intro: 'Camisolas de fútbol nuevas de estilo retro, elegidas por los jugadores, los goles y las épocas que seguimos recordando.',
    shopAll: 'Ver la colección', viewAll: 'Ver todas', collection: 'La colección',
    statement: ['No vendemos camisetas.', 'Archivamos recuerdos.'], regular: 'Precio regular', sale: 'Precio de oferta', save: (n) => `$${n} de descuento`,
    back: 'Volver a la colección', size: 'Talla', soldOutSize: 'agotada', add: 'Agregar al carrito', soldOut: 'Agotada',
    pickSize: 'Seleccioná una talla.', added: 'Agregada al carrito.', viewCart: 'Ver carrito',
    limit: 'Ya tenés todo nuestro inventario en esta talla.',
    details: 'Próximamente: medidas y detalles de la tela.',
    freeShip: 'Envío gratis en la compra de 2 camisolas o más.',
    yourCart: 'Tu carrito', emptyCart: 'Tu carrito está vacío.', remove: 'Quitar',
    fewer: 'Quitar una', more: 'Agregar una', subtotal: 'Subtotal', shipping: 'Envío', shipFree: 'Gratis',
    shipLater: 'Se calcula al pagar', oneMore: 'Agregá una camisola más para obtener envío gratis.',
    checkout: 'Pagar', checkoutSoon: 'El pago en línea abre pronto.',
    notFound: 'No encontramos esa página.', loadError: 'No se pudo cargar la colección. Recargá la página.',
    rights: 'Todos los precios en USD.',
    heroLead: 'Un libro de historia que se puede vestir. Seis camisolas, seis capítulos y las noches que las hicieron eternas.',
    openArchive: 'Abrir el archivo', chapter: 'Capítulo', era: 'Época', theMoment: 'El momento',
    watch: 'Ver resúmenes en YouTube', sources: 'Fuentes', photo: 'Foto', readChapter: 'Leer el capítulo', shopJersey: 'Comprar esta camisola',
    archiveLead: 'Cada camisola pertenece a una época, un jugador y una noche de la que todavía se habla. Este es el registro, en orden.',
    featureEyebrow: 'Por qué nos llamamos 90:00',
    everyPiece: ['Cada pieza cuenta una historia.', 'Cada detalle importa.', 'Cada momento, eterno.'],
    retroNote: 'Una camisola nueva inspirada en esta historia. No es una camisola usada en estos partidos.',
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

const archiveNumber = (p) => String(products.indexOf(p) + 1).padStart(3, '0');

function archiveTag(p) {
  const player = playerLine(p);
  return `<div class="tag" aria-hidden="true">
    <span class="tag-eyebrow">Archive ${archiveNumber(p)}</span>
    <span class="tag-team">${esc(p.team)}</span>
    <span class="tag-rule"></span>
    ${player ? `<span class="tag-player">${esc(player)}</span>` : ''}
    <span class="tag-mark">90:00</span>
  </div>`;
}

function visual(p) {
  if (p.images[0]) {
    const alt = [p.team, playerLine(p), p.title].filter(Boolean).join(', ');
    return `<div class="plate has-photo"><img src="${esc(p.images[0])}" alt="${esc(alt)}" width="1122" height="1402" loading="lazy"></div>`;
  }
  return `<div class="plate">${archiveTag(p)}</div>`;
}

function priceLine(p) {
  return `<div class="price-line">
    <span class="visually-hidden">${esc(t().regular)}:</span><span class="was">$${p.priceUsd}</span>
    <span class="visually-hidden">${esc(t().sale)}:</span><span class="now">$${finalPrice(p)}</span>
  </div>`;
}

function card(p, headingTag = 'h3') {
  const soldOut = totalStock(p) === 0;
  const meta = [p.team, playerLine(p)].filter(Boolean).join(' · ');
  const alt = [p.team, playerLine(p), p.title].filter(Boolean).join(', ');
  const media = p.images[0]
    ? `<div class="plate has-photo swap"><img src="${esc(p.images[0])}" alt="${esc(alt)}" width="502" height="886" loading="lazy">${p.images[1] ? `<img class="alt" src="${esc(p.images[1])}" alt="" width="510" height="886" loading="lazy">` : ''}</div>`
    : visual(p);
  return `<a class="card" href="/shop/${esc(p.slug)}" data-link>
    ${media}
    <div class="card-years">${esc(p.history.years)}</div>
    <${headingTag}>${esc(p.title)}</${headingTag}>
    <div class="meta">${esc(meta)}</div>
    ${soldOut ? `<div class="meta">${esc(t().soldOut)}</div>` : priceLine(p)}
  </a>`;
}

const chapterNumber = (p) => String(products.indexOf(p) + 1).padStart(2, '0');

function photoFigure(p) {
  const ph = p.history.photo;
  const licence = ph.licenseUrl ? `<a href="${esc(ph.licenseUrl)}" target="_blank" rel="noopener license">${esc(ph.license)}</a>` : esc(ph.license);
  return `<figure class="history-photo">
    <img src="${esc(ph.src)}" alt="${esc(ph.alt[lang])}" width="${ph.w}" height="${ph.h}" loading="lazy">
    <figcaption>${esc(ph.caption[lang])}
      <span class="credit">${esc(t().photo)}: <a href="${esc(ph.page)}" target="_blank" rel="noopener">${esc(ph.credit)}</a>, ${licence}</span>
    </figcaption>
  </figure>`;
}

// One chapter of the history book, used on the Archive page and on each jersey page.
function chapter(p, { onProductPage = false } = {}) {
  const h = p.history;
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(h.moment.query)}`;
  const stats = h.stats.map((x) => `<div class="stat"><b>${esc(x.value)}</b><span>${esc(x.label[lang])}</span></div>`).join('');
  const sources = h.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(' · ');
  return `<section class="chapter" id="${esc(p.slug)}">
    <header class="chapter-head">
      <p class="eyebrow">${esc(t().chapter)} ${chapterNumber(p)} · ${esc(p.title)}</p>
      <div class="chapter-years">${esc(h.years)}</div>
      <h2>${esc(h.headline[lang])}</h2>
    </header>
    <div class="chapter-body">
      <div class="chapter-copy">
        ${h.story[lang].map((x) => `<p>${esc(x)}</p>`).join('')}
        <aside class="moment">
          <p class="moment-label">${esc(t().theMoment)}</p>
          <p class="moment-date">${esc(h.moment.date[lang])}</p>
          <h3>${esc(h.moment.title[lang])}</h3>
          <p>${esc(h.moment.text[lang])}</p>
          <a href="${esc(youtube)}" target="_blank" rel="noopener">${esc(t().watch)} ↗</a>
        </aside>
        <div class="stats">${stats}</div>
      </div>
      ${photoFigure(p)}
    </div>
    <footer class="chapter-foot">
      ${onProductPage ? '' : `<a class="button" href="/shop/${esc(p.slug)}" data-link>${esc(t().shopJersey)}</a>`}
      <p class="sources">${esc(t().retroNote)}<br>${esc(t().sources)}: ${sources}</p>
    </footer>
  </section>`;
}

function renderChrome() {
  document.documentElement.lang = lang;
  document.querySelector('.skip').textContent = t().skip;
  const count = cartCount();
  header.innerHTML = `
    <nav class="nav-left"><a class="nav-link" href="/shop" data-link>${esc(t().shop)}</a><a class="nav-link" href="/archive" data-link>${esc(t().archive)}</a></nav>
    <a class="wordmark" href="/" data-link aria-label="90:00 Archive"><b>90:00</b><span>ARCHIVE</span></a>
    <div class="nav-right">
      <button class="lang" type="button" data-action="lang" aria-label="${esc(t().otherLangName)}">${esc(t().otherLang)}</button>
      <a class="nav-link" href="/cart" data-link>${esc(t().cart)} (${count})</a>
    </div>`;
  footer.innerHTML = `<img class="footer-logo" src="/assets/logo-ivory.png" alt="90:00 Archive" width="874" height="384"><em lang="en">${esc(TAGLINE)}</em><span>© ${new Date().getFullYear()} 90:00 Archive · ${esc(t().rights)}</span>`;
}

function renderHome() {
  document.title = '90:00 Archive';
  const names = products.map((p) => `<span>${esc(p.title)} <i>${esc(p.history.years)}</i></span>`).join('');
  const feature = bySlug('bayern-munchen');
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">90:00 Archive</p>
        <h1>${t().statement.map(esc).join('<br>')}</h1>
        <p class="intro">${esc(t().heroLead)}</p>
        <div class="hero-actions">
          <a class="button" href="/archive" data-link>${esc(t().openArchive)}</a>
          <a class="button ghost" href="/shop" data-link>${esc(t().shopAll)}</a>
        </div>
      </div>
      <div class="hero-panels" aria-hidden="true">
        ${['juventus-del-piero', 'arsenal-henry', 'real-madrid-raul'].map((slug) => `<img src="/assets/jerseys/${slug}-model.jpg" alt="" width="510" height="886">`).join('')}
      </div>
    </section>
    <div class="ticker" aria-hidden="true"><div class="ticker-track">${names}${names}${names}</div></div>
    <section class="feature">
      <img src="${esc(feature.history.photo.src)}" alt="${esc(feature.history.photo.alt[lang])}" width="1000" height="706" loading="lazy">
      <div class="feature-copy">
        <p class="eyebrow">${esc(t().featureEyebrow)}</p>
        <h2>${esc(feature.history.headline[lang])}</h2>
        <p>${esc(feature.history.moment.text[lang])}</p>
        <a class="button" href="/archive#${esc(feature.slug)}" data-link>${esc(t().readChapter)}</a>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>${esc(t().collection)}</h2><a href="/shop" data-link>${esc(t().viewAll)}</a></div>
      <div class="grid">${products.map((p) => card(p)).join('')}</div>
    </section>
    <section class="statement">
      <p>${t().everyPiece.map(esc).join('<br>')}</p>
      <div class="rule"></div>
      <b>90:00</b>
    </section>`;
}

function renderArchive() {
  document.title = `${t().archive} · 90:00 Archive`;
  const index = products.map((p) => `<a href="#${esc(p.slug)}"><b>${esc(p.history.years)}</b><span>${esc(p.title)}</span></a>`).join('');
  main.innerHTML = `
    <header class="archive-intro">
      <p class="eyebrow">90:00 Archive</p>
      <h1>${esc(t().archive)}</h1>
      <p>${esc(t().archiveLead)}</p>
      <nav class="archive-index">${index}</nav>
    </header>
    ${products.map((p) => chapter(p)).join('')}`;
}

function renderShop() {
  document.title = `${t().collection} · 90:00 Archive`;
  main.innerHTML = `<section class="section" style="border-top:0">
    <div class="section-head"><h1>${esc(t().collection)}</h1></div>
    <div class="grid">${products.map((p) => card(p, 'h2')).join('')}</div>
  </section>`;
}

function gallery(p) {
  if (!p.images[0]) return visual(p);
  const alt = [p.team, playerLine(p), p.title].filter(Boolean).join(', ');
  return p.images.map((src, i) => `<img src="${esc(src)}" alt="${i === 0 ? esc(alt) : ''}" ${i ? 'loading="lazy"' : ''}>`).join('');
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
    <div class="gallery">${gallery(p)}</div>
    <div class="buy">
      <a class="back" href="/shop" data-link>← ${esc(t().back)}</a>
      <p class="collection-name">${esc(t().era)} ${esc(p.history.years)}</p>
      <h1>${esc(p.title)}</h1>
      <p class="player">${esc([p.team, playerLine(p)].filter(Boolean).join(' · '))}</p>
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
  </article>
  ${chapter(p, { onProductPage: true })}`;
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
      ${freeShipping ? '' : `<p class="fine nudge">${esc(t().oneMore)}</p>`}
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
  if (path === '/archive') return renderArchive();
  if (path === '/cart') return renderCart();
  if (productMatch && bySlug(productMatch[1])) return renderProduct(bySlug(productMatch[1]));
  return renderMessage(t().notFound);
}

function scrollToHash() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}

function navigate(href) {
  history.pushState(null, '', href);
  route();
  scrollToHash();
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
scrollToHash();
