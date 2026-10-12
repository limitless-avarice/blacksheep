# Blacksheep store

Static front end (public/) plus an Express API (server.js) with JSON file storage.

## Run
    npm install
    ADMIN_TOKEN=your-secret npm start
Open http://localhost:3000

## Structure
- public/index.html, styles.css, app.js: storefront, cart, checkout
- public/data/products.json: catalogue (edit to add products, sizes, stock, prices in GHS)
- public/img/: logo, shirt photos, packaging banner
- server.js: API
- data/orders.json, data/subscribers.json: created on first order or signup

## API
- GET  /api/products?collection=&q=&sort=price-asc|price-desc
- GET  /api/products/:id
- POST /api/orders  { customer:{name,phone,email,address,city}, items:[{id,size,qty}] }  (price and stock checked on the server)
- POST /api/subscribe  { email }
- GET  /api/admin/orders and PATCH /api/admin/orders/:id {status}  (header x-admin-token)

## Notes
- The front end falls back to data/products.json when the API is offline, so it can be previewed by opening any static host. Checkout needs the server.
- Replace the number in the Chat button (wa.me/233000000000) with the real WhatsApp number.
- To move to a real database, swap the read/write helpers in server.js.
- Add a payment provider (for example Paystack or a mobile money API) at the order step before going live.
