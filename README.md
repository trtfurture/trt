# TRT Furniture & Interiors — Render-ready Flask marketplace

TRT is a mobile-first furniture and interiors storefront with a separate admin control centre. It includes a seeded launch catalogue, product/category/search pages, bag and checkout, order tracking, WhatsApp/call links, PWA install support, QR codes, referral links, SEO metadata/sitemap and store analytics.

## Deploy to Render

1. Unzip this project and push the contents of this folder to a GitHub repository (the `app.py` file must sit at the repository root).
2. In Render, create a **Web Service** from the repository.
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app --workers 1 --threads 4 --timeout 120` (or use the included `Procfile`).
5. Add these required environment variables in Render → Environment:
   - `ADMIN_USERNAME` — your chosen admin username.
   - `ADMIN_PASSWORD` — your chosen admin password.
6. Deploy. The public shop opens at `/`. Admin login opens at `/promise212324`.

There is deliberately **no `SECRET_KEY` environment variable**: admin authentication uses opaque, random tokens persisted as hashes in SQLite rather than Flask's signed-cookie session. Keep `ADMIN_PASSWORD` private.

### Keep orders and uploaded photos after redeploys

Render's regular service filesystem is ephemeral. For a live store where orders/products/photos must survive redeploys, attach a Render persistent disk mounted at `/var/data` and add this environment variable:

`DATA_DIR=/var/data`

The app will create its SQLite database and uploaded product photos inside that directory. Without a persistent disk, data is only as durable as the service's local filesystem.

## Store setup after first deploy

1. Sign into `/promise212324`.
2. Open **Store settings** and add your WhatsApp number in international format (for Kenya use `2547XXXXXXXX`, without `+`), phone number, email, location, delivery message and preferred colours.
3. In **Products & inventory**, replace the launch illustrations with your suppliers' real product pictures and verify the exact item name, finish, dimensions, seller stock, price and SKU. The seeded items make the shop usable for layout testing; do not advertise illustrative photos/prices as a supplier's confirmed stock.
4. Use **Store QR** to download the QR for your storefront. Product QR codes open the relevant product. Use **Referral links** to create individual links for suppliers, partners or campaigns.

## Payments: real provider details are required

Checkout saves each order as pending, returns a TRT order number, and supports a payment API initiation adapter, optional hosted payment links, authenticated callback processing and provider-side verification for the FinAPI/STKPush endpoint format. It will **not** falsely treat a customer returning to a success page as proof of payment.

The public Autopay API pages found during setup are focused on parking, not Kenyan furniture checkout. Do not point this store at an unrelated Autopay endpoint. For Kenya, first choose a payment provider/account that supports your retail flow and confirm its API/callback documentation. The API keys below are optional until you have actual provider credentials:

- `PAYMENT_API_URL` — the provider's payment-create endpoint (for the FinAPI example: `https://stkpush.co.ke/api/stk-push/`).
- `PAYMENT_API_KEY` — API key supplied by that provider.
- `PAYMENT_API_MODE` — `stkpush` for `phone_number`, `amount`, `reference` payloads; otherwise `generic` for the adapter's `order_no`, `amount`, `phone`, `callback_url`, etc. format.
- `PAYMENT_PROVIDER_NAME` — optional display/operation label.
- `PAYMENT_VERIFY_URL_TEMPLATE` — optional verification endpoint URL template containing `{transaction_id}` or `{order_no}`. For the FinAPI example: `https://stkpush.co.ke/api/verify-payment/{transaction_id}/`.
- `PAYMENT_WEBHOOK_TOKEN` — optional provider callback token expected as `X-Payment-Token` or `Authorization: Bearer ...` by `/webhooks/payment`. If the provider authenticates callbacks through HMAC or a different signature scheme, adapt the signature verification to that provider's documentation before enabling automatic callback confirmation.
- `PAYMENT_LINK_TEMPLATE` — optional hosted URL template containing placeholders `{order_no}`, `{amount}`, `{phone}`, `{name}`, `{email}`. It can also be saved through Store settings. A link does not itself prove payment; confirmation must come through the verified provider callback or verify endpoint.

Configure the public callback URL (when supported by the provider) as:

`https://YOUR-RENDER-SERVICE.onrender.com/webhooks/payment`

The callback endpoint accepts normalised `reference` / `order_no` fields, a typical nested M-Pesa STK callback shape and common `payment.success` event fields. Real production confirmation still depends on matching the selected provider's callback security and payload details. Run a small test transaction before taking live customer payments.

## Included admin tools

- Product CRUD: edit name, category, description, price, previous price, stock, badges, SEO slug, keywords, photo URL/upload, visibility and featured placement.
- Order desk: pending / confirmed / processing / ready / dispatched / delivered / cancelled; payment pending / initiated / paid / failed / refunded; customer contact, notes, totals, provider reference and CSV export.
- Analytics: page views, product views/clicks, searches, add-to-bag, WhatsApp/call clicks, checkout orders and referral codes.
- UI settings: shop announcement, homepage heading, brand name/tagline, colors, contact details, delivery notes and category labels.
- PWA: manifest, service worker and a dismissible install suggestion; it does not force users to install the app.
- Search/SEO: per-product canonical URL, product structured data, `robots.txt` and `sitemap.xml`.

## Notes

- SQLite is adequate for a compact initial catalogue and modest order volume. For a larger multi-seller operation, move orders and products to managed PostgreSQL and put supplier image uploads in object storage.
- Seed catalogue imagery comes from Unsplash image URLs as *visual launch examples*. Replace these with actual seller-owned/authorised product photos before launch.
- Delivery and availability are not hard-coded as guarantees. They are confirmed according to the seller and destination.
