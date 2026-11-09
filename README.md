# 90:00 Archive

Store for new retro-style football jerseys. Node and Express, with no front-end build step.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, and the admin at http://localhost:3000/admin. Local development uses a built-in database with no setup. Its admin password is in `.env`, which is never uploaded.

```bash
npm test
```

## Render (Web Service)

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

Settings on Render:

| Setting | What it does |
|---|---|
| `DATABASE_URL` | Connects the database. Without it the site shows `data/products.json`, and the admin and orders are unavailable. |
| `ADMIN_PASSWORD` | The admin password, at least 12 characters. Changing it signs everyone out. |
| `PUBLIC_URL` | The site's address. Defaults to https://90-00.com. |
| `STRIPE_SECRET_KEY` | Stripe key. A `sk_test_` key uses fake payments, and `sk_live_` takes real ones. |
| `STRIPE_WEBHOOK_SECRET` | Confirms payment messages really came from Stripe. |
| `CHECKOUT_ENABLED` | Must be `true` to open checkout. Sales stay off without it, even with Stripe keys set. |

Set the Stripe webhook to `https://90-00.com/api/stripe/webhook`, sending `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and `charge.dispute.created`.

## Editing the store

Once the database is connected, use the admin at `/admin`:

- **Jerseys:** add or edit jerseys, prices, stock, photos and Archive chapters.
- **Orders:** move orders from paid to packed, shipped and delivered, and add tracking and notes. Add manual orders for sales outside the website.
- **Settings:** set the shipping rate and shipping countries, and see what checkout still needs.

`data/products.json` only fills an empty database the first time it starts. After that the database is the source of truth, so edits to that file won't change the live store. Uploaded photos are stored in the database too.

Good to know:

- Stock drops when a customer starts checkout, or when a manual order is saved. Checkout lasts about 30 minutes, and unpaid or failed checkouts return their stock. Cancelling or refunding an order returns its stock too.
- Refunds and chargebacks made in Stripe flag the order for review in the admin. They don't change its status or stock.
- Marking an order refunded does not send money back. Issue the refund in Stripe first.
- The site does not send its own emails, such as shipping notices.

## Before opening sales

- [ ] Get licensing or authorized-distributor proof from the supplier for every jersey.
- [ ] Count physical stock and update `stock`.
- [ ] Add real photos, season, home or away, fabric, cut, measurements and care details.
- [ ] Add Stripe keys, test a full purchase with fake payments, then set `CHECKOUT_ENABLED`.
- [ ] Set the shipping rate and countries in the admin, and write a returns policy.
- [ ] Add policy pages (shipping, returns, privacy, terms) and contact details.
- [ ] Sort out business registration and sales tax.
- [ ] Confirm the Spanish tagline, the domain and the social handles.
- [ ] Remove `<meta name="robots" content="noindex">` from `public/index.html`.

## Decisions so far

- Price: $90 list, $10 off, $80 to the customer. Free shipping on 2 or more jerseys.
- Look: black background with warm sand archive cards and a small gold accent, based on the brand inspiration images.
- Shopify was ruled out. The site is custom and runs on Render.
- Payments use Stripe. Real sales stay off until licensing proof and shipping rates are settled.
- Don't describe jerseys as official, authentic, licensed or limited edition unless that has been verified.
- Don't invent product facts. Show them only after checking them against the physical jersey.
