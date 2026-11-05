# 90:00 Archive

Store for new retro-style soccer jerseys. Node and Express, with no front-end build step.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000.

## Render (Web Service)

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

`npm run build` checks `data/products.json` and fails the deploy if the catalog is broken.

## Edit the catalog

Everything is in `data/products.json`:

- `priceUsd` is the list price and `discountUsd` is the amount off. Customers pay the difference.
- `stock` is the units per size. Current numbers come from the confirmed order, not a physical count.
- `images` is a list of paths such as `/assets/jerseys/juventus-1.jpg`. Add files under `public/assets/`. The first image replaces the placeholder drawing.

## Before opening sales

- [ ] Get licensing or authorized-distributor proof from the supplier for every jersey.
- [ ] Count physical stock and update `stock`.
- [ ] Add real photos, season, home or away, fabric, cut, measurements and care details.
- [ ] Choose a payment provider and connect checkout. It is currently switched off.
- [ ] Set shipping rates and areas, and a returns policy.
- [ ] Add policy pages (shipping, returns, privacy, terms) and contact details.
- [ ] Sort out business registration and sales tax.
- [ ] Confirm the Spanish tagline, the domain and the social handles.
- [ ] Remove `<meta name="robots" content="noindex">` from `public/index.html`.

## Decisions so far

- Price: $90 list, $10 off, $80 to the customer. Free shipping on 2 or more jerseys.
- Shopify was ruled out. The site is custom and planned for Render.
- Don't describe jerseys as official, authentic, licensed or limited edition unless that has been verified.
- Don't invent product facts. Show them only after checking them against the physical jersey.
