# Hospital Café

A hospital food ordering and kitchen/admin management app. Patients scan a
QR code, order food with dish-specific paid add-ons, and track their order;
kitchen staff manage the menu, add-ons, and orders from a protected admin
dashboard.

**No payment functionality of any kind.** Patients place a food order; the
app calculates and displays the order bill/total only (a dummy "PAY NOW"
screen simulates success). No real online/cash/UPI payment is collected or
processed anywhere in this application.

**QR code entry.** Any QR code generator can point at `https://<your-site>/`
or `https://<your-site>/order` (both open the same patient ordering flow —
`/order` is just a friendlier link to encode in a QR image). The app does
not generate or scan QR codes itself; the room number is entered manually
by the patient after scanning.

**No patient personal data.** The app only collects a room number, food
items, quantities, selected add-ons, and optional special instructions. It
never asks for name, phone, email, patient ID, or any medical information.

**Food add-ons.** Each dish can have its own paid add-ons (e.g. Chicken
Biriyani → Extra Chicken +₹80, Boiled Egg +₹20). Add-ons are configured
per dish from Admin → Add-ons — nothing is available globally.

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
│   ├── db.js              # MySQL connection pool
│   ├── adminAuth.js       # simple in-memory admin session tokens
│   └── passwordUtil.js    # scrypt password hashing for staff_users
├── database/
│   ├── schema.sql         # full schema, for a fresh manual `mysql < schema.sql` setup
│   ├── seed_menu.sql      # the starter menu INSERT, shared by schema.sql and migrate.js
│   └── migrate.js         # non-destructive migration run automatically on every server start
├── routes/
│   ├── menu.js            # food items (+ each dish's own add-ons)
│   ├── addons.js          # add-on CRUD, admin-only
│   ├── orders.js          # cart pricing, order placement, status, stats
│   └── admin.js           # login, staff accounts, reports/CSV export
└── public/                # static frontend (patient + admin)
    ├── index.html          # patient flow: landing → room → menu → add-ons → cart → confirmation
    ├── admin.html           # admin login + dashboard (Orders / Menu / Add-ons / Reports / Staff)
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

   This creates the `hospital_food` database with `menu_items`, `addons`,
   `menu_item_addons`, `orders`, `order_items`, `order_item_addons`,
   `admin_activity_logs`, and `staff_users`, plus the starter menu.

   If you already have a deployed database, you don't need to run this by
   hand — `database/migrate.js` applies the same tables safely (only
   `CREATE TABLE IF NOT EXISTS` / additive `ALTER TABLE`) every time the
   server starts, without touching existing orders or menu data. See
   "Migrating an existing deployment" below.

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
DB_PORT=3306
PORT=3000
ADMIN_PASSWORD=123
# SEED_SAMPLE_ADDONS=false   # optional: skip the example Biriyani/Dosa/Tea add-ons
# REMOVE_DIET_CARE_DATA=true # optional, ONE deploy only: permanently drop legacy
#                             # diet_orders/diet_menu_items tables and diet_care accounts
```

`ADMIN_PASSWORD` bootstraps the first super-admin account (username
`admin`) the first time the server starts against an empty `staff_users`
table. After that, admins are managed from Admin → Staff Accounts, and
changing `ADMIN_PASSWORD` later has no effect. The password is never sent
to the frontend or embedded in HTML.

## 5. Install & run

```bash
npm install
npm start
```

Open: **http://localhost:3000/**

## 6. Using the app

### Patients

1. Scan the QR code (or open the site) → tap **FOOD ORDER**.
2. Enter the room number (e.g. `204`, `A-204`, `ICU-2`).
3. Browse the menu — filter by category and by Veg / Non-Veg.
4. Tap **+ Add** on an item to open its add-on sheet: tick any add-ons
   for that dish (each shows its own price), set the quantity, and tap
   **Add to Cart**. Items with no add-ons configured just show a
   quantity stepper.
5. Tap **View Cart** (sticky bottom bar) to see the Order Summary /
   Bill — base price, add-ons, and total per line — and optionally add
   special instructions.
6. Tap **PROCEED TO PAYMENT** → **PAY NOW** (test/demo payment).
7. See the confirmation screen with order number, itemized bill
   (including add-ons), total, and live status.

### Admin

1. Open the site → tap **ADMIN** (or go directly to `/admin.html`).
2. Log in with a staff username/password (bootstrapped account:
   `admin` / your `ADMIN_PASSWORD`).
3. **Active Orders tab** — live incoming orders with room, items,
   add-ons, payment, and a status dropdown
   (`Preparing → Ready → Delivered`, or `Cancelled` with a reason).
4. **Completed / History tab** — delivered/cancelled order archive with
   receipt timeline.
5. **Menu Management tab** — add, edit, enable/disable, or delete food
   items.
6. **Add-ons tab** — create/edit add-ons, set their price, and choose
   exactly which dishes each one applies to.
7. **Reports & Analytics tab** — date-range summary, revenue by
   category, and **Export CSV** (per food item, with add-ons, base
   price, add-on price, and total).
8. **Staff Accounts tab** (super admins only) — create/disable/delete
   admin logins.
9. Tap **Logout** to end the admin session and return to the login
   screen.

## 7. Price history

Order line items store the **unit price at the time the order was
placed** (`order_items.unit_price`). If an admin later changes a menu
item's price, past orders keep their original recorded price — they are
never recalculated against the current menu.

## 8. API overview

All prices are always read from and validated against MySQL — the
backend never trusts prices sent from the browser.

| Method | Endpoint                              | Access | Description |
|--------|-----------------------------------------|--------|--------------|
| GET    | `/api/menu`                            | Public | Available menu items, each with its own `addons[]` |
| GET    | `/api/menu/all`                        | Admin  | All items incl. disabled |
| POST   | `/api/menu`                             | Admin  | Add a food item |
| PUT    | `/api/menu/:id`                        | Admin  | Edit a food item |
| PATCH  | `/api/menu/:id/availability`           | Admin  | Enable/disable an item |
| DELETE | `/api/menu/:id`                        | Admin  | Delete an item |
| GET    | `/api/addons`                          | Admin  | All add-ons with the dishes each applies to |
| POST   | `/api/addons`                          | Admin  | Create an add-on: `{ name, price, available, menu_item_ids }` |
| PUT    | `/api/addons/:id`                      | Admin  | Edit an add-on and its dish links |
| PATCH  | `/api/addons/:id/availability`         | Admin  | Enable/disable an add-on |
| DELETE | `/api/addons/:id`                      | Admin  | Delete an add-on (past orders keep their own snapshot) |
| POST   | `/api/orders`                          | Public | Place a new order: `{ roomNumber, items: [{ itemId, quantity, addonIds }], specialInstructions }` |
| GET    | `/api/orders/room/:roomNumber`         | Public | A room's recent order history |
| GET    | `/api/orders/track/:id`                | Public | Live status polling for the confirmation screen |
| GET    | `/api/orders/active`                   | Admin  | Orders not yet Delivered/Completed/Cancelled |
| GET    | `/api/orders/completed`                | Admin  | Delivered/Completed/Cancelled archive (search/filter) |
| GET    | `/api/orders/:id`                      | Admin  | Single order detail incl. items and add-ons |
| PATCH  | `/api/orders/:id/status`               | Admin  | Set status to Preparing / Ready / Delivered / Cancelled |
| GET    | `/api/orders/stats/summary`            | Admin  | Today's dashboard statistics |
| POST   | `/api/admin/login`                     | Public | `{ username, password }` → `{ success, token, is_super }` |
| POST   | `/api/admin/logout`                    | Admin  | Invalidate the admin session token |
| GET/POST/PATCH/DELETE | `/api/admin/users[...]`  | Super admin | Manage staff accounts |
| GET    | `/api/admin/reports/daily`             | Admin  | Date-range summary + revenue by category |
| GET    | `/api/admin/reports/orders-list`       | Admin  | Per-order and per-item rows for CSV export |
| GET    | `/api/admin/reports/room/:roomNumber`  | Admin  | Room-wise order history |
| GET    | `/api/admin/audit-logs`                | Admin  | Recent admin actions |

Admin routes require an `Authorization: Bearer <token>` header, using
the token returned by `/api/admin/login`. This is a simple in-memory
token store — sufficient for a single-instance deployment, not intended
for production-grade multi-admin auth across multiple server processes.

## Migrating an existing deployment

`database/migrate.js` runs automatically every time the server starts
and only ever does two kinds of thing: `CREATE TABLE IF NOT EXISTS` and
`ALTER TABLE ... ADD COLUMN` guarded by a column-existence check. It
never drops or rewrites `orders`, `order_items`, or `menu_items`, so it
is safe to deploy over a live database with real order history. Legacy
Diet Care tables (`diet_orders`, `diet_menu_items`) and `diet_care`
staff accounts are left in place by default — set
`REMOVE_DIET_CARE_DATA=true` for one deploy if you want them permanently
deleted, then unset it again.

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
