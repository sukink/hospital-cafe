# Hospital Café

A simple hospital food ordering and kitchen/admin management demo app.

**No payment functionality of any kind.** Patients place a food order; the
app calculates and displays the order bill/total only. No online/cash/UPI
payment is collected or processed anywhere in this application.

**No QR functionality.** The app is a single website with two entry
points: FOOD ORDER and ADMIN. Any QR code is created *outside* this
project by pointing it at the hosted URL — the app itself does not
generate or scan QR codes, and the room number is always entered
manually by the patient.

**No patient personal data.** The app only collects a room number, food
items, quantities, and optional special instructions. It never asks for
name, phone, email, patient ID, or any medical information.

---

## 1. Requirements

- Node.js 18+
- MySQL 8+ (or MariaDB 10.5+)
- npm

## 2. Project structure

```
hospital-cafe/
├── package.json
├── server.js
├── .env.example
├── .gitignore
├── config/
│   ├── db.js            # MySQL connection pool
│   └── adminAuth.js     # simple in-memory admin session tokens
├── database/
│   └── schema.sql        # tables + seed data (7 menu items)
├── routes/
│   ├── menu.js
│   ├── orders.js
│   └── admin.js
└── public/                # static frontend (patient + admin)
    ├── index.html          # patient flow: landing → room → menu → cart → confirmation
    ├── admin.html           # admin login + dashboard
    ├── css/
    ├── js/
    │   ├── config.js        # API_BASE_URL — edit this for production
    │   ├── cart.js
    │   ├── app.js
    │   └── admin.js
    └── assets/
        ├── logo/
        ├── food/
        ├── icons/
        └── images/
```

## 3. MySQL setup

1. Start your MySQL server.
2. Create the database and tables (this also inserts the 7 starter menu
   items):

   ```bash
   mysql -u root -p < database/schema.sql
   ```

   This creates the `hospital_food` database with three tables:
   `menu_items`, `orders`, `order_items`.

## 4. Environment configuration

Copy the example env file and fill in your local MySQL credentials:

```bash
cp .env.example .env
```

`.env`:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=hospital_food
PORT=3000
ADMIN_PASSWORD=123
```

`ADMIN_PASSWORD` is the demo admin password (`123` by default). Change it
for anything beyond local testing. The password is never sent to the
frontend or embedded in HTML — it's only checked server-side in
`POST /api/admin/login`.

## 5. Install & run

```bash
npm install
npm start
```

Open: **http://localhost:3000/**

## 6. Using the app

### Patients

1. Open the site → tap **FOOD ORDER**.
2. Enter the room number (e.g. `204`, `A-204`, `ICU-2`).
3. Browse the menu — filter by category (Breakfast / Main Course /
   Snacks / Beverages) and by Veg / Non-Veg.
4. Tap **+ Add** on items, adjust quantity with the stepper.
5. Tap **View Cart** (sticky bottom bar) to see the Order Summary /
   Bill, optionally add special instructions.
6. Tap **PLACE ORDER**.
7. See the confirmation screen with order number, itemized bill, total,
   and status (Pending).

### Admin

1. Open the site → tap **ADMIN** (or go directly to `/admin.html`).
2. Enter the demo password: `123`.
3. **Orders tab** — view all orders (cards on mobile, table on
   desktop), filter by status, change status via the dropdown
   (`Pending → Preparing → Ready → Delivered`, or `Cancelled`).
4. **Menu tab** — add, edit, enable/disable, or delete food items.
5. **Statistics tab** — pending/preparing/ready/delivered counts,
   today's order count, and today's total order amount (not a payment
   figure — just the sum of order bills placed today).
6. Tap **LOGOUT** to end the admin session and return to the landing
   page.

## 7. Price history

Order line items store the **unit price at the time the order was
placed** (`order_items.unit_price`). If an admin later changes a menu
item's price, past orders keep their original recorded price — they are
never recalculated against the current menu.

## 8. API overview

All prices are always read from and validated against MySQL — the
backend never trusts prices sent from the browser.

| Method | Endpoint                          | Access | Description |
|--------|-------------------------------------|--------|--------------|
| GET    | `/api/menu`                        | Public | Available menu items |
| GET    | `/api/menu/all`                    | Admin  | All items incl. disabled |
| POST   | `/api/menu`                         | Admin  | Add a food item |
| PUT    | `/api/menu/:id`                    | Admin  | Edit a food item |
| PATCH  | `/api/menu/:id/availability`       | Admin  | Enable/disable an item |
| DELETE | `/api/menu/:id`                    | Admin  | Delete an item |
| POST   | `/api/orders`                      | Public | Place a new order |
| GET    | `/api/orders`                      | Admin  | List all orders (optional `?status=`) |
| GET    | `/api/orders/:id`                  | Admin  | Single order detail |
| PATCH  | `/api/orders/:id`                  | Admin  | Update order status |
| GET    | `/api/orders/stats/summary`        | Admin  | Dashboard statistics |
| POST   | `/api/admin/login`                 | Public | `{ "password": "123" }` → `{ success, token }` |
| POST   | `/api/admin/logout`                | Admin  | Invalidate the admin session token |

Admin routes require an `Authorization: Bearer <token>` header, using
the token returned by `/api/admin/login`. This is a simple in-memory
token store — sufficient for a demo, not intended for production-grade
multi-admin auth.

## 9. Adding your logo / food images

- Drop your hospital logo at `public/assets/logo/logo.png`.
- Drop food photos (transparent PNG/WebP preferred) in
  `public/assets/food/`, e.g. `idly.png`, `dosa.png`,
  `chicken-biriyani.png`, `veg-sandwich.png`, `egg-sandwich.png`,
  `tea.png`, `coffee.png`.
- The app ships with emoji placeholders for food images so it works
  immediately with no images. To switch to real images, update the
  `img-wrap` markup in `public/js/app.js` to render
  `<img src="assets/food/<filename>">` instead of the emoji icon, and
  set each menu item's `image` field (via Admin → Menu → Edit, or
  directly in `menu_items.image`) to the filename.

## 10. Changing prices / categories / menu

Everything is editable from **Admin → Menu**: name, category, serving,
veg/non-veg, description, price, and enabled/disabled state. No direct
SQL editing is required for day-to-day changes.

## 11. Deployment

### Frontend → GitHub Pages

GitHub Pages only serves **static files** (HTML/CSS/JS) — it cannot run
Node.js, Express, or MySQL. To deploy the frontend there:

1. Push the contents of `public/` to a GitHub repository (e.g. as the
   root of a `gh-pages` branch, or via the "Pages" settings pointing at
   `public/`).
2. Your site will be live at:
   `https://<username>.github.io/<repo>/`
3. Edit `public/js/config.js` and set `window.API_BASE_URL` to your
   deployed backend's URL (see below) for anything other than
   `localhost`.

### Backend → separate hosting

Deploy `server.js` + `routes/` + `config/` + `database/` + `package.json`
to any Node-friendly host that also gives you a MySQL database, e.g.
Render, Railway, Fly.io, a VPS, or similar. Steps:

1. Provision a MySQL database and run `database/schema.sql` against it.
2. Set environment variables (`DB_HOST`, `DB_USER`, `DB_PASSWORD`,
   `DB_NAME`, `PORT`, `ADMIN_PASSWORD`) in your hosting provider's
   dashboard — never commit a real `.env` file.
3. Deploy; note the public URL (e.g. `https://your-backend.onrender.com`).
4. Update `public/js/config.js`'s production branch with that URL, then
   redeploy the frontend to GitHub Pages.

### QR code (created externally, not by this app)

Once the frontend is hosted, generate **one** QR code (with any
external QR generator) pointing at your GitHub Pages URL, e.g.
`https://username.github.io/hospital-cafe/`. Print/place the same QR
code in every room. Scanning it just opens the website; the patient
still manually enters their room number on the next screen. This app
does not generate, scan, or store QR codes, and QR codes never encode a
room number.

## 12. Testing checklist

1. `npm start`, open `http://localhost:3000/`.
2. **FOOD ORDER** → room `204` → add Idly × 2, Tea × 1 → cart shows
   ₹120 + ₹25 = **₹145** → add note "Less spicy" → **PLACE ORDER** →
   confirmation shows Order # , Room 204, ₹145 total, status Pending.
3. Go to **ADMIN** → password `123` → dashboard opens → find the order
   in the Orders tab with the correct room, items, total, and note →
   change status Pending → Preparing → Ready → Delivered, confirming
   each update persists.
4. **Price history**: note Idly's current price, place an order, then
   in Admin → Menu edit Idly's price, then place a second order — the
   first order should still show the original price when viewed in
   Admin → Orders.
5. Confirm no payment button, payment page, or payment status appears
   anywhere in the patient or admin flows.
