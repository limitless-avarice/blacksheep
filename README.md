# Blacksheep store

Static front end (`public/`) plus an Express API (`server.js`) with JSON file storage.

## Run locally
    npm install
    npm start
Open http://localhost:3000. In development the admin token is printed in the terminal when you start the server.
To set your own: `ADMIN_TOKEN=a-long-secret npm start`.

## Folder layout
    server.js
    package.json
    .env.example          list of settings (see below)
    public/
      index.html, styles.css, app.js     storefront, cart, checkout, order tracking
      admin.html                         admin page at /admin (orders, stock, subscribers)
      policy.html                        delivery, returns, privacy, terms (edit before launch)
      data/products.json                 catalogue: names, prices (GHS), sizes, starting stock, editionSize
      data/locations.json                towns, delivery fee for each town, delivery days and time slots
      img/                               logo.png, grey-front.jpg, grey-back.jpg, white-front.jpg, white-back.jpg, packaging.jpg

## Settings (environment variables)
| Name | What it does |
| --- | --- |
| NODE_ENV=production | Refuses to start without a strong ADMIN_TOKEN |
| ADMIN_TOKEN | Password for /admin (12+ characters) |
| DATA_DIR | Folder for orders, stock and subscribers. Must be on a persistent disk in production |
| SITE_URL | Your live address, used for payment return links and emails |
| WHATSAPP_NUMBER | Digits only with country code, for the Chat button and nothing else |
| PAYSTACK_SECRET_KEY | Turns on pay-now (card and mobile money). Empty means pay on delivery only |
| RESEND_API_KEY, MAIL_FROM, OWNER_EMAIL | Order confirmation emails to customers and to you |
| DROP_DATE | ISO date, for example 2026-11-20T10:00:00Z. Shows a countdown bar |
| INSTAGRAM_URL, TIKTOK_URL | Footer links |

Promo codes are at the top of `server.js` (marked EDIT).

## Delivery places, fees and schedule (`public/data/locations.json`)
- Each town has its own `fee`. Tema is 50 and every other Greater Accra town is 100. Change any town's fee, add or remove towns.
- `otherRegion` is the fee for anywhere outside Greater Accra (the customer types their town).
- `schedule`: `earliestDaysAhead` (1 = from tomorrow, 0 = same day), `daysToShow`, `closedWeekdays` (0 = Sunday ... 6 = Saturday) and `timeSlots`.
- `freeDeliveryOver`: 0 means off.
Restart the server after editing the file.

## Stock
`products.json` holds the starting stock. After the first start, live stock is kept in `DATA_DIR/stock.json` and changed through /admin, so redeploying never resets it.

## API
- GET  /api/config, /api/products, /api/products/:id
- POST /api/promo {code}
- POST /api/orders {customer, items, payment: "online"|"delivery", promo}
- GET  /api/orders/verify?reference=BS-XXXXXX
- POST /api/orders/track {id, phone}
- POST /api/paystack/webhook  (set this URL in the Paystack dashboard)
- POST /api/subscribe, POST /api/notify
- /api/admin/* with header x-admin-token: orders, stock, subscribers
