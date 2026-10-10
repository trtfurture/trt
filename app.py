from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any

import requests
from flask import (
    Flask, abort, flash, g, jsonify, make_response, redirect, render_template,
    request, send_from_directory, url_for
)
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "instance")).expanduser().resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "trt_marketplace.db"
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
ADMIN_PATH = "/promise212324"
CURRENCY = "KSh"

app = Flask(__name__, static_folder="static", template_folder="templates")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    MAX_CONTENT_LENGTH=8 * 1024 * 1024,
    SESSION_COOKIE_NAME="trt_admin_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

CATEGORIES = [
    ("sofas", "Sofas & Living", "Sofa sets, sectionals, recliners and occasional seating"),
    ("coffee-tables", "Coffee Tables", "Coffee tables, nesting tables and statement centrepieces"),
    ("dining", "Dining", "Dining tables, chairs and complete dining sets"),
    ("bedroom", "Bedroom", "Beds, mattresses, bedside tables and bedroom suites"),
    ("wardrobes", "Wardrobes & Storage", "Wardrobes, cabinets, dressers and storage solutions"),
    ("mirrors", "Mirrors & Consoles", "Framed mirrors, vanity mirrors and console tables"),
    ("lighting", "Lighting", "Pendant lights, floor lamps, table lamps and wall lights"),
    ("decor", "Home Décor", "Vases, wall art, accents and finishing touches"),
    ("office", "Office Furniture", "Office chairs, desks and work-from-home pieces"),
    ("doors-glass", "Doors & Glass", "Interior doors, glass features and architectural details"),
    ("tiles", "Tiles & Surfaces", "Floor and wall finishes for considered interiors"),
    ("outdoor", "Outdoor Living", "Patio seating, outdoor tables and garden accents"),
]

# Royalty-free Unsplash CDN images are used for the launch catalogue. Replace them with each seller's
# exact product photos from the admin product editor before publishing live inventory.
SEED_PRODUCTS = [
    {"name":"Marlow 3-Seater Sofa", "category":"sofas", "price":48500, "compare_price":54000, "sku":"TRT-SF-001", "stock":5, "featured":1, "badge":"Bestseller", "image":"https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1100&q=82", "description":"A welcoming, tailored three-seater with generous cushions and a refined silhouette. Ask us about available upholstery colours and delivery."},
    {"name":"Sable L-Shape Lounge", "category":"sofas", "price":79500, "compare_price":0, "sku":"TRT-SF-002", "stock":3, "featured":1, "badge":"Room maker", "image":"https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1100&q=82", "description":"A spacious sectional concept for relaxed family living and entertaining. Confirm dimensions and fabric availability with the seller."},
    {"name":"Noir Mirror-Frame Coffee Table", "category":"coffee-tables", "price":18500, "compare_price":22000, "sku":"TRT-CT-001", "stock":8, "featured":1, "badge":"Statement piece", "image":"https://images.unsplash.com/photo-1499933374294-4584851497cc?auto=format&fit=crop&w=1100&q=82", "description":"A striking low table with a dark frame and reflective styling. A sophisticated centrepiece for contemporary living rooms."},
    {"name":"Aurelia Nesting Tables", "category":"coffee-tables", "price":14500, "compare_price":0, "sku":"TRT-CT-002", "stock":6, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1100&q=82", "description":"Flexible nesting tables designed to add dimension without visual clutter. Finish and measurements can be confirmed before ordering."},
    {"name":"Oakline Six-Seater Dining Set", "category":"dining", "price":68500, "compare_price":74000, "sku":"TRT-DN-001", "stock":4, "featured":1, "badge":"Gather beautifully", "image":"https://images.unsplash.com/photo-1604578762246-41134e37f9cc?auto=format&fit=crop&w=1100&q=82", "description":"A warm dining set for everyday meals and hosting. Contact TRT to confirm chair finish, table dimensions and delivery."},
    {"name":"Luma Accent Chair", "category":"dining", "price":12500, "compare_price":0, "sku":"TRT-CH-001", "stock":10, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=1100&q=82", "description":"A sculptural accent chair with a clean profile, suitable for dining, reading corners or a bedroom dressing area."},
    {"name":"Serene Upholstered Bed", "category":"bedroom", "price":56000, "compare_price":61000, "sku":"TRT-BD-001", "stock":3, "featured":1, "badge":"Rest, reimagined", "image":"https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1100&q=82", "description":"A calm, upholstered bedroom focal point. Mattress size, headboard fabric and assembly options should be agreed before payment."},
    {"name":"Forma Wardrobe Suite", "category":"wardrobes", "price":43500, "compare_price":0, "sku":"TRT-WD-001", "stock":2, "featured":0, "badge":"Made for order", "image":"https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1100&q=82", "description":"A considered storage concept for bedrooms and dressing rooms. Ask the supplier about available widths, finishes and custom sizing."},
    {"name":"Arc Full-Length Mirror", "category":"mirrors", "price":9800, "compare_price":11500, "sku":"TRT-MR-001", "stock":7, "featured":1, "badge":"Small-space hero", "image":"https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1100&q=82", "description":"A full-length mirror that brings light and visual space to entryways, bedrooms and dressing areas."},
    {"name":"Obsidian Console Table", "category":"mirrors", "price":16900, "compare_price":0, "sku":"TRT-CS-001", "stock":4, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&w=1100&q=82", "description":"A refined console for a hallway or living area, made to pair with mirrors, lamps and sculptural décor."},
    {"name":"Solstice Pendant Light", "category":"lighting", "price":8900, "compare_price":0, "sku":"TRT-LT-001", "stock":9, "featured":1, "badge":"Lighting edit", "image":"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1100&q=82", "description":"An elegant lighting accent for dining areas, bedrooms and lounge spaces. Electrical fittings and installation are confirmed separately."},
    {"name":"Noma Ceramic Décor Set", "category":"decor", "price":4200, "compare_price":0, "sku":"TRT-DC-001", "stock":15, "featured":0, "badge":"Finishing touch", "image":"https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?auto=format&fit=crop&w=1100&q=82", "description":"Textural decorative pieces that create a layered, curated look on shelves, coffee tables and consoles."},
    {"name":"Axis Executive Desk", "category":"office", "price":24500, "compare_price":0, "sku":"TRT-OF-001", "stock":5, "featured":0, "badge":"Work beautifully", "image":"https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1100&q=82", "description":"A clean-lined desk concept for home offices and commercial workspaces. Ask about dimensions, cable access and matching storage."},
    {"name":"Milo Ergonomic Office Chair", "category":"office", "price":13800, "compare_price":0, "sku":"TRT-OF-002", "stock":8, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1505843490701-5be5d1b1e823?auto=format&fit=crop&w=1100&q=82", "description":"A supportive office chair for focused work. The listed image is illustrative; confirm exact model and specifications with the seller."},
    {"name":"Linea Timber Interior Door", "category":"doors-glass", "price":28500, "compare_price":0, "sku":"TRT-DR-001", "stock":6, "featured":0, "badge":"Interior details", "image":"https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1100&q=82", "description":"A warm interior-door style for renovation and new-build projects. Measurements, hardware and installation are quoted to your requirements."},
    {"name":"Calmstone Porcelain Tile", "category":"tiles", "price":1850, "compare_price":0, "sku":"TRT-TL-001", "stock":120, "featured":0, "badge":"Per m² estimate", "image":"https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1100&q=82", "description":"A neutral stone-look surface for considered interiors. Verify price unit, stock batch and area calculations with the supplier before ordering."},
    {"name":"Terrace Woven Lounge Set", "category":"outdoor", "price":38500, "compare_price":0, "sku":"TRT-OD-001", "stock":4, "featured":0, "badge":"Outdoor edit", "image":"https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?auto=format&fit=crop&w=1100&q=82", "description":"An inviting outdoor seating concept for patios and covered terraces. Confirm weather suitability and included pieces before purchase."},
    {"name":"Nero Bedside Table Pair", "category":"bedroom", "price":11200, "compare_price":0, "sku":"TRT-BD-002", "stock":8, "featured":0, "badge":"Pair of 2", "image":"https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1100&q=82", "description":"A matching pair of compact bedside tables to give a bedroom a finished, balanced feel."},
    {"name":"Lounge Media Console", "category":"sofas", "price":21900, "compare_price":0, "sku":"TRT-TV-001", "stock":4, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1100&q=82", "description":"A clean media-storage concept for living spaces, with styling that works alongside warm woods and dark accents."},
    {"name":"Halo Table Lamp", "category":"lighting", "price":5600, "compare_price":0, "sku":"TRT-LT-002", "stock":12, "featured":0, "badge":"", "image":"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1100&q=82", "description":"Ambient lighting for bedside tables, entry consoles or a quiet reading nook. Ask about the actual finish and bulb requirements."},
]

DEFAULT_SETTINGS = {
    "site_name": "TRT",
    "tagline": "The Room, Refined.",
    "announcement": "Thoughtful furniture. Considered interiors. Made easier.",
    "hero_title": "Make room for\na better kind of living.",
    "hero_text": "Furniture, lighting and finishing touches for spaces that feel unmistakably yours.",
    "whatsapp": "",
    "phone": "",
    "email": "",
    "address": "Kenya",
    "currency": "KSh",
    "delivery_fee": "0",
    "delivery_note": "Delivery costs and timelines are confirmed for your location before an order is finalised.",
    "payment_name": "M-Pesa / payment link",
    "payment_instructions": "Choose your preferred payment option at checkout. We will confirm payment before fulfilment.",
    "payment_link_template": "",
    "primary_color": "#29241f",
    "accent_color": "#a77a4f",
    "page_bg": "#f7f4ef",
    "store_notice": "Images are launch illustrations. Confirm exact finish, dimensions and availability with the seller before payment.",
    "instagram_url": "",
    "facebook_url": "",
    "show_prices": "yes",
    "maintenance_note": "",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0,
      compare_price REAL NOT NULL DEFAULT 0, sku TEXT DEFAULT '', stock INTEGER NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '', extra_images TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '',
      badge TEXT DEFAULT '', featured INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL,
      phone TEXT NOT NULL, email TEXT DEFAULT '', address TEXT NOT NULL, city TEXT DEFAULT '', notes TEXT DEFAULT '',
      delivery_method TEXT DEFAULT 'delivery', subtotal REAL NOT NULL, delivery_fee REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT DEFAULT 'mpesa', provider_reference TEXT DEFAULT '', payment_url TEXT DEFAULT '',
      referral_code TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER, product_name TEXT NOT NULL, product_slug TEXT DEFAULT '', unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL, line_total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, product_id INTEGER,
      query TEXT DEFAULT '', category TEXT DEFAULT '', page_path TEXT DEFAULT '', session_id TEXT DEFAULT '',
      referral_code TEXT DEFAULT '', metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, username TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL, attempted_at REAL NOT NULL, success INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referral_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
      created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS admin_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT DEFAULT '', provider_reference TEXT DEFAULT '',
      status TEXT NOT NULL, payload TEXT DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category, active);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, payment_status);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_query ON analytics(query);
    """)
    for key, value in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))
    for slug, title, _desc in CATEGORIES:
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (f"category:{slug}", title))
    count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    if count == 0:
        for p in SEED_PRODUCTS:
            conn.execute("""INSERT INTO products
              (slug,name,category,description,price,compare_price,sku,stock,image,extra_images,tags,badge,featured,active,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (slugify(p["name"]),p["name"],p["category"],p["description"],p["price"],p["compare_price"],p["sku"],p["stock"],p["image"],"[]",p["category"],p.get("badge",""),p["featured"],1,now_iso(),now_iso()))
    conn.commit()
    conn.close()


def slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return text[:110] or f"item-{secrets.token_hex(3)}"


def rowdict(row):
    return dict(row) if row is not None else None


def get_settings() -> dict[str, str]:
    db = get_db()
    data = DEFAULT_SETTINGS.copy()
    for row in db.execute("SELECT key, value FROM settings"):
        if not row["key"].startswith("category:"):
            data[row["key"]] = row["value"]
    return data


def setting(key: str, default: str = "") -> str:
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else DEFAULT_SETTINGS.get(key, default)


def current_admin() -> sqlite3.Row | None:
    token = request.cookies.get(app.config["SESSION_COOKIE_NAME"], "")
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = get_db().execute("SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at > ?", (token_hash, now_iso())).fetchone()
    if row:
        g.admin_csrf = row["csrf_token"]
        g.admin_token_hash = token_hash
        return row
    return None


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not getattr(g, "admin", None):
            if request.path.startswith("/api/admin/") or request.is_json:
                return jsonify({"ok": False, "error": "Admin login required."}), 401
            return redirect(url_for("admin_login", next=request.path))
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            expected = getattr(g, "admin_csrf", "")
            given = request.form.get("csrf_token") or request.headers.get("X-TRT-CSRF", "")
            if not expected or not given or not secrets.compare_digest(expected, given):
                if request.is_json:
                    return jsonify({"ok": False, "error": "Security check failed. Refresh and try again."}), 400
                abort(400, description="Security check failed. Refresh the page and try again.")
        return view(*args, **kwargs)
    return wrapped


@app.before_request
def load_request_context():
    g.settings = get_settings()
    g.admin = current_admin()
    g.admin_csrf = getattr(g, "admin_csrf", "")


def add_admin_notice(message: str, category: str = "success") -> None:
    token_hash = getattr(g, "admin_token_hash", "")
    if token_hash:
        get_db().execute("INSERT INTO admin_notices(token_hash,category,message,created_at) VALUES(?,?,?,?)", (token_hash, category, str(message)[:500], now_iso()))
        get_db().commit()


def consume_admin_notices():
    token_hash = getattr(g, "admin_token_hash", "")
    if not token_hash:
        return []
    db = get_db()
    rows = db.execute("SELECT id,category,message FROM admin_notices WHERE token_hash=? ORDER BY id", (token_hash,)).fetchall()
    if rows:
        db.executemany("DELETE FROM admin_notices WHERE id=?", [(row["id"],) for row in rows])
        db.commit()
    return [(row["category"], row["message"]) for row in rows]


@app.context_processor
def inject_globals():
    db = get_db()
    cats = []
    for slug, title, desc in CATEGORIES:
        custom = setting(f"category:{slug}", title)
        count = db.execute("SELECT COUNT(*) FROM products WHERE active=1 AND category=?", (slug,)).fetchone()[0]
        cats.append({"slug": slug, "name": custom, "description": desc, "count": count})
    return {
        "site": get_settings(), "categories": cats, "category_names": {c[0]: setting(f"category:{c[0]}", c[1]) for c in CATEGORIES}, "admin_user": getattr(g, "admin", None),
        "csrf_token": getattr(g, "admin_csrf", ""), "admin_notices": consume_admin_notices(), "currency": setting("currency", CURRENCY),
        "whatsapp_link": build_whatsapp_url,
        "year": datetime.now().year,
    }


def product_query(active_only=True):
    query = "SELECT * FROM products"
    if active_only:
        query += " WHERE active=1"
    return query


def get_product_by_slug(slug: str, active_only=True):
    sql = "SELECT * FROM products WHERE slug=?"
    if active_only:
        sql += " AND active=1"
    return get_db().execute(sql, (slug,)).fetchone()


def image_src(value: str) -> str:
    if not value:
        return "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=80"
    if value.startswith(("https://", "http://", "/")):
        return value
    return url_for("media_upload", filename=value)


def track(event_type: str, *, product_id=None, query="", category="", page_path="", session_id="", referral_code="", metadata=None):
    allowed = {"page_view", "product_view", "category_view", "search", "product_click", "whatsapp_click", "call_click", "add_to_cart", "remove_from_cart", "begin_checkout", "order_created", "payment_link", "referral_visit", "qr_visit", "share_click", "install_prompt", "contact_click"}
    if event_type not in allowed:
        return
    get_db().execute("""INSERT INTO analytics(event_type,product_id,query,category,page_path,session_id,referral_code,metadata,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)""", (event_type, product_id, str(query)[:180], str(category)[:100], str(page_path)[:300], str(session_id)[:100], str(referral_code)[:80], json.dumps(metadata or {}, ensure_ascii=False)[:2000], now_iso()))
    get_db().commit()


def client_session() -> str:
    # A random, non-authentication analytics identifier. No exact client IP is stored.
    return re.sub(r"[^A-Za-z0-9_-]", "", request.headers.get("X-TRT-Session", ""))[:100]


def normalise_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif digits.startswith("7") or digits.startswith("1"):
        if len(digits) == 9:
            digits = "254" + digits
    return digits


def format_money(amount: float) -> str:
    return f"{setting('currency', CURRENCY)} {amount:,.0f}"


@app.template_filter("money")
def money_filter(amount):
    try:
        return format_money(float(amount or 0))
    except Exception:
        return f"{CURRENCY} 0"


@app.template_filter("image_src")
def image_src_filter(value):
    return image_src(value)


def build_whatsapp_url(message: str = "") -> str:
    phone = normalise_phone(setting("whatsapp", ""))
    if not phone:
        return ""
    params = {"text": message} if message else {}
    return f"https://wa.me/{phone}" + ("?" + urllib.parse.urlencode(params) if params else "")


def payment_env_status() -> dict[str, Any]:
    return {
        "api_url": os.environ.get("PAYMENT_API_URL", "").strip(),
        "api_key": os.environ.get("PAYMENT_API_KEY", "").strip(),
        "api_name": os.environ.get("PAYMENT_PROVIDER_NAME", "Configured payment provider").strip(),
        "webhook_token_set": bool(os.environ.get("PAYMENT_WEBHOOK_TOKEN", "").strip()),
        "api_configured": bool(os.environ.get("PAYMENT_API_URL", "").strip() and os.environ.get("PAYMENT_API_KEY", "").strip()),
        "link_template": os.environ.get("PAYMENT_LINK_TEMPLATE", "").strip() or setting("payment_link_template", "").strip(),
        "verify_template_set": bool(os.environ.get("PAYMENT_VERIFY_URL_TEMPLATE", "").strip()) or "stkpush.co.ke/api/stk-push" in os.environ.get("PAYMENT_API_URL", ""),
    }


def make_payment_link(order: sqlite3.Row) -> str:
    config = payment_env_status()
    template = config["link_template"]
    if not template:
        return ""
    values = {
        "order_no": urllib.parse.quote(str(order["order_no"])),
        "amount": urllib.parse.quote(f"{float(order['total']):.2f}"),
        "phone": urllib.parse.quote(str(order["phone"])),
        "name": urllib.parse.quote(str(order["customer_name"])),
        "email": urllib.parse.quote(str(order["email"] or "")),
    }
    try:
        return template.format(**values)
    except (KeyError, ValueError):
        return ""


def initiate_provider_payment(order_id: int) -> tuple[bool, str, str, str]:
    """Provider-neutral HTTP adapter.

    Configure PAYMENT_API_URL, PAYMENT_API_KEY, and (if needed) PAYMENT_API_MODE.
    Supported modes: `stkpush` (common phone_number/amount/reference payload) or `generic`
    (order/amount/phone/callback_url payload). A successful response can return a hosted
    payment URL or a provider/checkout reference. Provider-specific response schemas may need
    a small adapter change to achieve verified live auto-confirmation.
    """
    cfg = payment_env_status()
    order = get_db().execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return False, "Order not found.", "", ""
    payment_link = make_payment_link(order)
    if not cfg["api_configured"]:
        if payment_link:
            get_db().execute("UPDATE orders SET payment_url=?, payment_status='initiated', updated_at=? WHERE id=?", (payment_link, now_iso(), order_id))
            get_db().commit()
            return True, "Your payment page is ready. Complete payment there; the order will remain pending until confirmed.", payment_link, ""
        return False, "Online payment has not been connected yet. Your order is saved as pending; contact TRT to complete payment.", "", ""

    mode = os.environ.get("PAYMENT_API_MODE", "stkpush").strip().lower()
    callback = url_for("payment_webhook", _external=True)
    if mode == "generic":
        payload = {"order_no": order["order_no"], "amount": round(float(order["total"]), 2), "currency": setting("currency", CURRENCY), "phone": order["phone"], "customer_name": order["customer_name"], "email": order["email"], "callback_url": callback, "return_url": url_for("payment_return", order_no=order["order_no"], _external=True)}
    else:
        payload = {"phone_number": normalise_phone(order["phone"]), "amount": round(float(order["total"]), 2), "reference": order["order_no"]}
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + cfg["api_key"], "Accept": "application/json"}
    url = cfg["api_url"]
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=(6, 18))
        data = response.json() if response.content else {}
        if response.status_code >= 400:
            message = data.get("message") or data.get("error") or f"Payment provider returned HTTP {response.status_code}."
            get_db().execute("INSERT INTO payment_events(order_no,status,payload,created_at) VALUES(?,?,?,?)", (order["order_no"], "initiation_error", json.dumps(data)[:4000], now_iso()))
            get_db().commit()
            return False, str(message)[:240], "", ""
        status = str(data.get("status", data.get("ResponseDescription", "initiated"))).lower()
        checkout_url = next((str(data[k]) for k in ("checkout_url", "payment_url", "redirect_url", "paymentLink", "payment_link", "url") if data.get(k)), "")
        provider_ref = next((str(data[k]) for k in ("CheckoutRequestID", "checkout_request_id", "request_id", "reference_id", "transaction_id", "id") if data.get(k)), "")
        if checkout_url:
            get_db().execute("UPDATE orders SET payment_url=?, provider_reference=?, payment_status='initiated', updated_at=? WHERE id=?", (checkout_url, provider_ref, now_iso(), order_id))
            get_db().execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order["order_no"], provider_ref, "link_created", json.dumps(data)[:4000], now_iso()))
            get_db().commit()
            return True, "Payment page created. Complete payment; confirmation will update the order when the provider calls the webhook.", checkout_url, provider_ref
        if provider_ref or status in {"success", "successful", "accepted", "pending", "initiated", "queued"}:
            get_db().execute("UPDATE orders SET provider_reference=?, payment_status='initiated', updated_at=? WHERE id=?", (provider_ref, now_iso(), order_id))
            get_db().execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order["order_no"], provider_ref, "prompt_initiated", json.dumps(data)[:4000], now_iso()))
            get_db().commit()
            return True, str(data.get("message") or data.get("ResponseDescription") or "Payment request sent. Check the customer's phone and keep the order pending until confirmation.")[:300], "", provider_ref
        return False, str(data.get("message") or "The provider response did not include a payment URL or reference.")[:300], "", ""
    except requests.RequestException as exc:
        app.logger.warning("Payment provider request failed for %s: %s", order["order_no"], exc)
        return False, "Could not reach the payment provider. Your order is saved as pending; try again or contact TRT.", "", ""
    except ValueError:
        return False, "Payment provider returned a response we could not read. Your order remains pending.", "", ""


@app.get("/")
def home():
    db = get_db()
    featured = db.execute("SELECT * FROM products WHERE active=1 ORDER BY featured DESC, id DESC LIMIT 12").fetchall()
    fresh = db.execute("SELECT * FROM products WHERE active=1 ORDER BY created_at DESC LIMIT 8").fetchall()
    if request.args.get("ref"):
        code = request.args.get("ref", "")[:80]
        track("referral_visit", page_path="/", session_id=client_session(), referral_code=code)
        resp = make_response(render_template("home.html", products=featured, fresh=fresh))
        resp.set_cookie("trt_ref", code, max_age=60*60*24*30, samesite="Lax", httponly=False, secure=request.is_secure or request.headers.get("X-Forwarded-Proto") == "https")
        return resp
    return render_template("home.html", products=featured, fresh=fresh)


@app.get("/shop")
def shop():
    db = get_db()
    q = request.args.get("q", "").strip()[:100]
    category = request.args.get("category", "").strip()[:100]
    sort = request.args.get("sort", "featured")
    page = max(1, min(int(request.args.get("page", 1) or 1), 10000))
    per_page = 16
    conditions = ["active=1"]
    args: list[Any] = []
    if q:
        conditions.append("(name LIKE ? OR description LIKE ? OR sku LIKE ? OR tags LIKE ?)")
        token = f"%{q}%"
        args += [token, token, token, token]
        track("search", query=q, category=category, page_path=request.full_path[:300], session_id=client_session())
    if category:
        conditions.append("category=?")
        args.append(category)
        track("category_view", category=category, page_path=request.full_path[:300], session_id=client_session())
    where = " WHERE " + " AND ".join(conditions)
    total = db.execute("SELECT COUNT(*) FROM products" + where, args).fetchone()[0]
    order_by = {"price-low":"price ASC", "price-high":"price DESC", "newest":"created_at DESC", "name":"name ASC", "featured":"featured DESC, id DESC"}.get(sort, "featured DESC, id DESC")
    items = db.execute(f"SELECT * FROM products{where} ORDER BY {order_by} LIMIT ? OFFSET ?", args + [per_page, (page-1)*per_page]).fetchall()
    return render_template("shop.html", products=items, q=q, selected_category=category, sort=sort, page=page, per_page=per_page, total=total, page_count=max(1, (total+per_page-1)//per_page))


@app.get("/category/<slug>")
def category_page(slug):
    valid = {x[0]: x[1] for x in CATEGORIES}
    if slug not in valid:
        abort(404)
    return redirect(url_for("shop", category=slug))


@app.get("/product/<slug>")
def product_page(slug):
    product = get_product_by_slug(slug)
    if not product:
        abort(404)
    track("product_view", product_id=product["id"], category=product["category"], page_path=request.path, session_id=client_session())
    similar = get_db().execute("SELECT * FROM products WHERE active=1 AND category=? AND id<>? ORDER BY featured DESC LIMIT 4", (product["category"], product["id"])).fetchall()
    return render_template("product.html", product=product, similar=similar)


@app.get("/api/search/suggest")
def search_suggest():
    q = request.args.get("q", "").strip()[:100]
    if len(q) < 2:
        return jsonify({"ok": True, "products": []})
    pattern = f"%{q}%"
    rows = get_db().execute("SELECT id,name,slug,category,price,image,stock FROM products WHERE active=1 AND (name LIKE ? OR description LIKE ? OR tags LIKE ? OR sku LIKE ?) ORDER BY featured DESC, name ASC LIMIT 6", (pattern,pattern,pattern,pattern)).fetchall()
    return jsonify({"ok": True, "products": [{"id":r["id"],"name":r["name"],"slug":r["slug"],"category":setting(f"category:{r['category']}",r["category"]),"price":r["price"],"image":image_src(r["image"]),"stock":r["stock"]} for r in rows]})


@app.get("/search")
def search_page():
    return redirect(url_for("shop", q=request.args.get("q", "")))


@app.get("/cart")
def cart_page():
    return render_template("cart.html")


@app.get("/checkout")
def checkout_page():
    return render_template("checkout.html", delivery_fee=float(setting("delivery_fee", "0") or 0))


@app.get("/order/<order_no>")
def order_status(order_no):
    order = get_db().execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        abort(404)
    # Order tracking is intentionally read-only and reveals only this order's details.
    items = get_db().execute("SELECT * FROM order_items WHERE order_id=?", (order["id"],)).fetchall()
    return render_template("order_status.html", order=order, items=items)


@app.get("/payment/return")
def payment_return():
    order_no = request.args.get("order_no", "")[:50]
    order = get_db().execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        abort(404)
    return redirect(url_for("order_status", order_no=order_no))


@app.post("/api/analytics")
def analytics_api():
    data = request.get_json(silent=True) or {}
    event = str(data.get("event", ""))[:40]
    product_id = data.get("product_id")
    try:
        product_id = int(product_id) if product_id is not None else None
    except (ValueError, TypeError):
        product_id = None
    track(event, product_id=product_id, query=data.get("query", ""), category=data.get("category", ""), page_path=data.get("path", request.path), session_id=data.get("session_id", client_session()), referral_code=data.get("referral_code", request.cookies.get("trt_ref", "")), metadata=data.get("metadata", {}))
    return jsonify({"ok": True})


@app.post("/api/orders")
def create_order():
    data = request.get_json(silent=True) or request.form.to_dict()
    name = str(data.get("name", "")).strip()[:120]
    phone = normalise_phone(str(data.get("phone", "")))
    email = str(data.get("email", "")).strip()[:180]
    address = str(data.get("address", "")).strip()[:300]
    city = str(data.get("city", "")).strip()[:100]
    notes = str(data.get("notes", "")).strip()[:1000]
    method = str(data.get("payment_method", "mpesa")).lower()
    delivery_method = str(data.get("delivery_method", "delivery")).lower()
    if not name or len(phone) < 10 or not address:
        return jsonify({"ok": False, "error": "Enter your name, a valid Kenyan phone number and delivery address/pick-up location."}), 400
    items = data.get("items", [])
    if isinstance(items, str):
        try: items = json.loads(items)
        except Exception: items = []
    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "Your cart is empty. Add products before checkout."}), 400
    db = get_db()
    clean_items = []
    subtotal = 0.0
    for item in items[:50]:
        try:
            pid = int(item.get("id", 0))
            qty = max(1, min(20, int(item.get("quantity", item.get("qty", 1)))))
        except (ValueError, TypeError, AttributeError):
            continue
        product = db.execute("SELECT * FROM products WHERE id=? AND active=1", (pid,)).fetchone()
        if not product:
            continue
        if product["stock"] >= 0 and qty > product["stock"]:
            return jsonify({"ok": False, "error": f"Only {product['stock']} of {product['name']} are currently listed in stock. Please adjust your cart or contact us."}), 409
        price = float(product["price"])
        subtotal += price * qty
        clean_items.append((product, qty, price))
    if not clean_items:
        return jsonify({"ok": False, "error": "We could not match the cart to available products. Refresh the shop and try again."}), 400
    delivery_fee = 0 if delivery_method == "pickup" else max(0, float(setting("delivery_fee", "0") or 0))
    total = round(subtotal + delivery_fee, 2)
    order_no = "TRT-" + datetime.now().strftime("%y%m%d") + "-" + secrets.token_hex(3).upper()
    referral = str(data.get("referral_code", request.cookies.get("trt_ref", "")))[:80]
    try:
        cur = db.execute("""INSERT INTO orders(order_no,customer_name,phone,email,address,city,notes,delivery_method,subtotal,delivery_fee,total,status,payment_status,payment_method,referral_code,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending','pending',?,?,?,?)""", (order_no,name,phone,email,address,city,notes,delivery_method,subtotal,delivery_fee,total,method,referral,now_iso(),now_iso()))
        order_id = cur.lastrowid
        for product, qty, price in clean_items:
            db.execute("INSERT INTO order_items(order_id,product_id,product_name,product_slug,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?,?)", (order_id, product["id"], product["name"], product["slug"], price, qty, price*qty))
        db.commit()
    except sqlite3.Error:
        db.rollback()
        app.logger.exception("Failed saving TRT checkout")
        return jsonify({"ok": False, "error": "We could not save this order. Please try again."}), 500
    track("order_created", page_path="/checkout", session_id=client_session(), referral_code=referral, metadata={"order_no": order_no, "amount": total})
    payment_url, payment_message, provider_ref = "", "", ""
    if method in {"mpesa", "online", "autopay", "card"}:
        ok, payment_message, payment_url, provider_ref = initiate_provider_payment(order_id)
        if not ok:
            payment_message = payment_message or setting("payment_instructions", "Contact TRT to complete payment.")
        if payment_url:
            track("payment_link", page_path="/checkout", session_id=client_session(), referral_code=referral, metadata={"order_no": order_no})
    else:
        payment_message = setting("payment_instructions", "Your order has been received. TRT will contact you to confirm payment and delivery.")
    order = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    items_saved = db.execute("SELECT * FROM order_items WHERE order_id=?", (order_id,)).fetchall()
    wa_message = f"Hello TRT, I have placed order {order_no}. Total: {format_money(total)}. Name: {name}. Phone: {phone}. Please confirm the order and delivery details."
    return jsonify({"ok": True, "order_no": order_no, "order_url": url_for("order_status", order_no=order_no), "payment_url": payment_url, "payment_message": payment_message, "payment_reference": provider_ref, "total": total, "formatted_total": format_money(total), "whatsapp_url": build_whatsapp_url(wa_message), "payment_status": order["payment_status"]}), 201


@app.post("/api/orders/<order_no>/verify-payment")
def verify_order_payment(order_no):
    data = request.get_json(silent=True) or {}
    phone = normalise_phone(str(data.get("phone", "")))
    order = get_db().execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        return jsonify({"ok": False, "error": "Order not found."}), 404
    if not phone or phone != normalise_phone(order["phone"]):
        return jsonify({"ok": False, "error": "Enter the phone number used at checkout."}), 403
    if order["payment_status"] == "paid":
        return jsonify({"ok": True, "paid": True, "message": "This order is already marked paid."})
    cfg = payment_env_status()
    if not cfg["api_configured"] or not order["provider_reference"]:
        return jsonify({"ok": False, "error": "A provider transaction reference is not available yet. Contact TRT if payment was made."}), 409
    verify_template = os.environ.get("PAYMENT_VERIFY_URL_TEMPLATE", "").strip()
    if not verify_template and "stkpush.co.ke/api/stk-push" in cfg["api_url"]:
        verify_template = "https://stkpush.co.ke/api/verify-payment/{transaction_id}/"
    if not verify_template:
        return jsonify({"ok": False, "error": "This payment provider does not have a verification endpoint configured. The order remains pending until a verified callback or manual review."}), 409
    try:
        verify_url = verify_template.format(transaction_id=urllib.parse.quote(str(order["provider_reference"]), safe=""), order_no=urllib.parse.quote(str(order["order_no"]), safe=""))
    except (KeyError, ValueError):
        return jsonify({"ok": False, "error": "PAYMENT_VERIFY_URL_TEMPLATE must use {transaction_id} or {order_no}."}), 500
    try:
        response = requests.get(verify_url, headers={"Authorization": "Bearer " + cfg["api_key"], "Accept": "application/json"}, timeout=(6, 15))
        result = response.json() if response.content else {}
        provider_status = str(result.get("status", "")).strip().lower()
        success = response.ok and (result.get("success") is True) and provider_status in {"success", "successful", "completed", "paid"}
        if success:
            db = get_db()
            db.execute("UPDATE orders SET payment_status='paid', status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END, updated_at=? WHERE id=?", (now_iso(), order["id"]))
            db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, order["provider_reference"], "verified_paid", json.dumps(result)[:4000], now_iso()))
            db.commit()
            return jsonify({"ok": True, "paid": True, "message": "The provider confirms payment. Your order is marked paid."})
        message = result.get("message") or "The provider has not confirmed this payment yet. Complete the prompt or check again shortly."
        get_db().execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, order["provider_reference"], "verify_not_paid", json.dumps(result)[:4000], now_iso()))
        get_db().commit()
        return jsonify({"ok": True, "paid": False, "message": str(message)[:300]})
    except (requests.RequestException, ValueError):
        return jsonify({"ok": False, "error": "Could not reach the payment provider. The order remains pending; try again shortly."}), 502


@app.post("/api/payments/retry/<order_no>")
def retry_payment(order_no):
    data = request.get_json(silent=True) or {}
    phone = normalise_phone(str(data.get("phone", "")))
    order = get_db().execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        return jsonify({"ok": False, "error": "Order not found."}), 404
    if phone and phone != normalise_phone(order["phone"]):
        return jsonify({"ok": False, "error": "The phone number does not match this order."}), 403
    if order["payment_status"] == "paid":
        return jsonify({"ok": True, "message": "This order is already marked paid."})
    ok, message, link, reference = initiate_provider_payment(order["id"])
    return jsonify({"ok": ok, "message": message, "payment_url": link, "payment_reference": reference})


@app.post("/webhooks/payment")
def payment_webhook():
    """Generic payment callback. For automatic confirmation set PAYMENT_WEBHOOK_TOKEN or adapt
    signature verification to the actual gateway. A callback is never accepted as paid merely
    because a browser landed on the success URL.
    """
    token = os.environ.get("PAYMENT_WEBHOOK_TOKEN", "").strip()
    if not token:
        return jsonify({"ok": False, "error": "Webhook confirmation is not enabled until PAYMENT_WEBHOOK_TOKEN is configured."}), 503
    provided = request.headers.get("X-Payment-Token", "")
    auth = request.headers.get("Authorization", "")
    if not provided and auth.lower().startswith("bearer "):
        provided = auth[7:].strip()
    if not provided or not secrets.compare_digest(provided, token):
        return jsonify({"ok": False, "error": "Invalid webhook authentication."}), 401
    data = request.get_json(silent=True) or request.form.to_dict()
    # Accept a normalized callback or a typical nested M-Pesa STK callback.
    callback = ((data.get("Body") or {}).get("stkCallback") or {}) if isinstance(data.get("Body"), dict) else {}
    order_no = str(data.get("reference", data.get("order_no", data.get("TransactionReference", data.get("merchant_reference", "")))))[:80]
    status = str(data.get("status", data.get("payment_status", data.get("event", data.get("ResultDesc", ""))))).lower()
    result_code = callback.get("ResultCode")
    if result_code is not None:
        status = "success" if str(result_code) == "0" else "failed"
    callback_meta = {}
    try:
        callback_meta = {str(entry.get("Name")): entry.get("Value") for entry in ((callback.get("CallbackMetadata") or {}).get("Item") or []) if isinstance(entry, dict)}
    except Exception:
        callback_meta = {}
    reference = str(data.get("TransactionReceipt", data.get("transaction_id", data.get("CheckoutRequestID", callback.get("CheckoutRequestID", data.get("payment_id", ""))))))[:120]
    success_values = {"paid", "success", "successful", "completed", "payment.success", "confirmed", "0", "completed_successfully"}
    failed_values = {"failed", "cancelled", "canceled", "rejected", "payment.failed", "timeout"}
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone() if order_no else None
    if not order and reference:
        order = db.execute("SELECT * FROM orders WHERE provider_reference=? ORDER BY id DESC LIMIT 1", (reference,)).fetchone()
        if order:
            order_no = order["order_no"]
    if not order_no:
        return jsonify({"ok": False, "error": "Order reference is missing."}), 400
    if not order:
        return jsonify({"ok": False, "error": "Order reference not found."}), 404
    # When supplied by a gateway, the confirmed amount must equal the saved order total.
    amount = data.get("amount", data.get("TransactionAmount", data.get("paid_amount", callback_meta.get("Amount"))))
    receipt_reference = callback_meta.get("MpesaReceiptNumber")
    if receipt_reference:
        reference = str(receipt_reference)[:120]
    if status in success_values:
        if amount is not None:
            try:
                if abs(float(amount) - float(order["total"])) > 0.01:
                    db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, reference, "amount_mismatch", json.dumps(data)[:4000], now_iso()))
                    db.commit()
                    return jsonify({"ok": False, "error": "Payment amount does not match order total; order left pending for review."}), 409
            except (TypeError, ValueError):
                return jsonify({"ok": False, "error": "Payment amount is invalid."}), 400
        db.execute("UPDATE orders SET payment_status='paid', status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END, provider_reference=?, updated_at=? WHERE id=?", (reference or order["provider_reference"], now_iso(), order["id"]))
        db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, reference, "paid", json.dumps(data)[:4000], now_iso()))
        db.commit()
        return jsonify({"ok": True, "order_no": order_no, "payment_status": "paid"})
    if status in failed_values:
        db.execute("UPDATE orders SET payment_status='failed', updated_at=? WHERE id=?", (now_iso(), order["id"]))
        db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, reference, "failed", json.dumps(data)[:4000], now_iso()))
        db.commit()
        return jsonify({"ok": True, "order_no": order_no, "payment_status": "failed"})
    db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order_no, reference, "unmapped_callback:" + status[:60], json.dumps(data)[:4000], now_iso()))
    db.commit()
    return jsonify({"ok": True, "message": "Callback recorded for review; status was not auto-marked paid."})


@app.get("/robots.txt")
def robots_txt():
    body = f"User-agent: *\nAllow: /\nDisallow: {ADMIN_PATH}\nDisallow: /api/\nDisallow: /checkout\nDisallow: /cart\nSitemap: {url_for('sitemap_xml', _external=True)}\n"
    return app.response_class(body, mimetype="text/plain")


@app.get("/sitemap.xml")
def sitemap_xml():
    base = request.url_root.rstrip("/")
    db = get_db()
    urls = [(base + url_for("home"), now_iso()[:10], "daily", "1.0"), (base + url_for("shop"), now_iso()[:10], "daily", "0.9")]
    for slug, _name, _desc in CATEGORIES:
        urls.append((base + url_for("shop", category=slug), now_iso()[:10], "weekly", "0.7"))
    for p in db.execute("SELECT slug, updated_at FROM products WHERE active=1 ORDER BY id DESC"):
        urls.append((base + url_for("product_page", slug=p["slug"]), (p["updated_at"] or now_iso())[:10], "weekly", "0.8"))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, date, freq, priority in urls:
        xml.append(f"<url><loc>{loc}</loc><lastmod>{date}</lastmod><changefreq>{freq}</changefreq><priority>{priority}</priority></url>")
    xml.append("</urlset>")
    return app.response_class("\n".join(xml), mimetype="application/xml")


@app.get("/manifest.json")
def manifest():
    data = {"name": "TRT Furniture & Interiors", "short_name": "TRT", "description": "Furniture and interior finds, thoughtfully brought together.", "start_url": "/?source=pwa", "scope": "/", "display": "standalone", "background_color": setting("page_bg", "#f7f4ef"), "theme_color": setting("primary_color", "#29241f"), "icons": [{"src": "/static/img/trt-icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}]}
    return jsonify(data)


@app.get("/sw.js")
def service_worker():
    return send_from_directory(BASE_DIR / "static", "sw.js", mimetype="application/javascript")


@app.get("/media/<path:filename>")
def media_upload(filename):
    # Upload directory may be on a persistent Render disk via DATA_DIR=/var/data.
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/qr.png")
def site_qr():
    import qrcode
    from io import BytesIO
    target = request.args.get("url", url_for("home", _external=True))[:600]
    from urllib.parse import urlparse
    parsed = urlparse(target)
    if parsed.scheme not in {"http", "https"}:
        target = url_for("home", _external=True)
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=9, border=3)
    qr.add_data(target); qr.make(fit=True)
    image = qr.make_image(fill_color="#29241f", back_color="#ffffff")
    bio = __import__("io").BytesIO(); image.save(bio, format="PNG"); bio.seek(0)
    return app.response_class(bio.getvalue(), mimetype="image/png", headers={"Cache-Control":"public, max-age=3600"})


@app.get("/qr/<slug>.png")
def product_qr(slug):
    product = get_product_by_slug(slug)
    if not product: abort(404)
    return redirect(url_for("site_qr", url=url_for("product_page", slug=slug, _external=True)))


# Admin authentication uses opaque database-backed sessions, not Flask's signed-cookie session.
# This intentionally avoids requiring SECRET_KEY in the hosting environment.
@app.route(ADMIN_PATH, methods=["GET", "POST"])
def admin_login():
    if g.admin:
        return redirect(url_for("admin_dashboard"))
    error = ""
    configured = bool(os.environ.get("ADMIN_USERNAME", "").strip() and os.environ.get("ADMIN_PASSWORD", ""))
    if request.method == "POST":
        username = request.form.get("username", "")[:120]
        password = request.form.get("password", "")
        fingerprint = hashlib.sha256((request.remote_addr or "unknown").encode()).hexdigest()[:24]
        db = get_db()
        cutoff = time.time() - 15 * 60
        db.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))
        attempts = db.execute("SELECT COUNT(*) FROM login_attempts WHERE fingerprint=? AND attempted_at>=? AND success=0", (fingerprint, cutoff)).fetchone()[0]
        if attempts >= 8:
            error = "Too many attempts. Wait 15 minutes, then try again."
        elif not configured:
            error = "Admin login is not enabled yet. Add ADMIN_USERNAME and ADMIN_PASSWORD in Render Environment."
            db.execute("INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,0)", (fingerprint,time.time())); db.commit()
        elif secrets.compare_digest(username, os.environ.get("ADMIN_USERNAME", "")) and secrets.compare_digest(password, os.environ.get("ADMIN_PASSWORD", "")):
            token = secrets.token_urlsafe(42)
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            csrf = secrets.token_urlsafe(32)
            expiry = (datetime.now(timezone.utc) + timedelta(hours=12)).replace(microsecond=0).isoformat()
            db.execute("INSERT INTO admin_sessions(token_hash,csrf_token,username,created_at,expires_at) VALUES(?,?,?,?,?)", (token_hash,csrf,username,now_iso(),expiry))
            db.execute("INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,1)", (fingerprint,time.time())); db.commit()
            response = make_response(redirect(request.args.get("next") if request.args.get("next", "").startswith("/promise212324") else url_for("admin_dashboard")))
            response.set_cookie(app.config["SESSION_COOKIE_NAME"], token, max_age=12*60*60, httponly=True, secure=request.is_secure or request.headers.get("X-Forwarded-Proto") == "https", samesite="Lax", path="/")
            return response
        else:
            error = "Those credentials do not match. Check your Render environment variables."
            db.execute("INSERT INTO login_attempts(fingerprint,attempted_at,success) VALUES(?,?,0)", (fingerprint,time.time())); db.commit()
    return render_template("admin_login.html", error=error, configured=configured)


@app.post(ADMIN_PATH + "/logout")
@admin_required
def admin_logout():
    token = request.cookies.get(app.config["SESSION_COOKIE_NAME"], "")
    if token:
        get_db().execute("DELETE FROM admin_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)); get_db().commit()
    response = make_response(redirect(url_for("admin_login")))
    response.delete_cookie(app.config["SESSION_COOKIE_NAME"], path="/")
    return response


@app.get(ADMIN_PATH + "/dashboard")
@admin_required
def admin_dashboard():
    db = get_db()
    today = datetime.now(timezone.utc).date().isoformat()
    since7 = (datetime.now(timezone.utc) - timedelta(days=7)).replace(microsecond=0).isoformat()
    since30 = (datetime.now(timezone.utc) - timedelta(days=30)).replace(microsecond=0).isoformat()
    metrics = {
        "products": db.execute("SELECT COUNT(*) FROM products WHERE active=1").fetchone()[0],
        "orders": db.execute("SELECT COUNT(*) FROM orders").fetchone()[0],
        "pending_orders": db.execute("SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','processing','ready')").fetchone()[0],
        "unpaid": db.execute("SELECT COUNT(*) FROM orders WHERE payment_status<>'paid'").fetchone()[0],
        "revenue": db.execute("SELECT COALESCE(SUM(total),0) FROM orders WHERE payment_status='paid'").fetchone()[0],
        "visits7": db.execute("SELECT COUNT(*) FROM analytics WHERE event_type='page_view' AND created_at>=?", (since7,)).fetchone()[0],
        "product_views7": db.execute("SELECT COUNT(*) FROM analytics WHERE event_type='product_view' AND created_at>=?", (since7,)).fetchone()[0],
        "cart_adds7": db.execute("SELECT COUNT(*) FROM analytics WHERE event_type='add_to_cart' AND created_at>=?", (since7,)).fetchone()[0],
        "whatsapp7": db.execute("SELECT COUNT(*) FROM analytics WHERE event_type='whatsapp_click' AND created_at>=?", (since7,)).fetchone()[0],
        "orders30": db.execute("SELECT COUNT(*) FROM orders WHERE created_at>=?", (since30,)).fetchone()[0],
    }
    recent_orders = db.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 8").fetchall()
    top_searches = db.execute("SELECT query, COUNT(*) AS n FROM analytics WHERE event_type='search' AND query<>'' GROUP BY query ORDER BY n DESC LIMIT 8").fetchall()
    top_products = db.execute("SELECT p.id,p.name,p.slug,COUNT(a.id) AS n FROM products p LEFT JOIN analytics a ON a.product_id=p.id AND a.event_type IN ('product_view','product_click') WHERE p.active=1 GROUP BY p.id ORDER BY n DESC LIMIT 6").fetchall()
    events = db.execute("SELECT event_type, COUNT(*) AS n FROM analytics WHERE created_at>=? GROUP BY event_type ORDER BY n DESC", (since7,)).fetchall()
    return render_template("admin_dashboard.html", metrics=metrics, recent_orders=recent_orders, top_searches=top_searches, top_products=top_products, events=events)


@app.get(ADMIN_PATH + "/products")
@admin_required
def admin_products():
    products = get_db().execute("SELECT * FROM products ORDER BY active DESC, id DESC").fetchall()
    return render_template("admin_products.html", products=products, edit_product=None)


def save_product_from_form(product_id: int | None = None):
    form = request.form
    name = form.get("name", "").strip()[:180]
    if not name:
        add_admin_notice("Product name is required.", "error")
        return redirect(url_for("admin_products"))
    category = form.get("category", "decor").strip()
    if category not in {x[0] for x in CATEGORIES}:
        category = "decor"
    slug = slugify(form.get("slug", "").strip() or name)
    existing_slug = get_db().execute("SELECT id FROM products WHERE slug=? AND id<>COALESCE(?, -1)", (slug, product_id)).fetchone()
    if existing_slug:
        slug = slug + "-" + secrets.token_hex(2)
    try:
        price = max(0.0, float(form.get("price", 0) or 0))
        compare_price = max(0.0, float(form.get("compare_price", 0) or 0))
        stock = max(0, int(form.get("stock", 0) or 0))
    except ValueError:
        add_admin_notice("Price and stock must be valid numbers.", "error")
        return redirect(url_for("admin_products"))
    image = form.get("image_url", "").strip()[:1000]
    old = get_db().execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone() if product_id else None
    if old and not image:
        image = old["image"]
    file = request.files.get("image_file")
    if file and file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            add_admin_notice("Use a JPG, PNG, WebP or GIF image.", "error")
            return redirect(url_for("admin_products"))
        safe = secure_filename(file.filename)
        generated = f"{slug}-{secrets.token_hex(4)}.{ext}"
        file.save(UPLOAD_DIR / generated)
        image = generated
    if not image:
        image = old["image"] if old else SEED_PRODUCTS[0]["image"]
    active = 1 if form.get("active") == "on" else 0
    featured = 1 if form.get("featured") == "on" else 0
    values = (slug, name, category, form.get("description", "").strip()[:4000], price, compare_price,
              form.get("sku", "").strip()[:100], stock, image, form.get("tags", "").strip()[:400],
              form.get("badge", "").strip()[:100], featured, active, now_iso())
    db = get_db()
    if product_id:
        db.execute("""UPDATE products SET slug=?,name=?,category=?,description=?,price=?,compare_price=?,sku=?,stock=?,image=?,tags=?,badge=?,featured=?,active=?,updated_at=? WHERE id=?""", values + (product_id,))
        add_admin_notice("Product updated.", "success")
    else:
        db.execute("""INSERT INTO products(slug,name,category,description,price,compare_price,sku,stock,image,tags,badge,featured,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", values[:13] + (now_iso(), values[13]))
        add_admin_notice("Product added to TRT.", "success")
    db.commit()
    return redirect(url_for("admin_products"))


@app.post(ADMIN_PATH + "/products/add")
@admin_required
def admin_product_add():
    return save_product_from_form()


@app.get(ADMIN_PATH + "/products/<int:product_id>/edit")
@admin_required
def admin_product_edit(product_id):
    product = get_db().execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
    if not product: abort(404)
    products = get_db().execute("SELECT * FROM products ORDER BY id DESC").fetchall()
    return render_template("admin_products.html", products=products, edit_product=product)


@app.post(ADMIN_PATH + "/products/<int:product_id>/edit")
@admin_required
def admin_product_save(product_id):
    if not get_db().execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone(): abort(404)
    return save_product_from_form(product_id)


@app.post(ADMIN_PATH + "/products/<int:product_id>/delete")
@admin_required
def admin_product_delete(product_id):
    get_db().execute("UPDATE products SET active=0, updated_at=? WHERE id=?", (now_iso(), product_id)); get_db().commit()
    add_admin_notice("Product hidden from the public shop. Existing order history is preserved.", "success")
    return redirect(url_for("admin_products"))


@app.get(ADMIN_PATH + "/orders")
@admin_required
def admin_orders():
    status = request.args.get("status", "")
    payment = request.args.get("payment", "")
    q = request.args.get("q", "").strip()[:100]
    sql = "SELECT * FROM orders WHERE 1=1"
    args: list[Any] = []
    if status:
        sql += " AND status=?"; args.append(status)
    if payment:
        sql += " AND payment_status=?"; args.append(payment)
    if q:
        sql += " AND (order_no LIKE ? OR customer_name LIKE ? OR phone LIKE ?)"; args += [f"%{q}%"]*3
    orders = get_db().execute(sql + " ORDER BY id DESC LIMIT 300", args).fetchall()
    return render_template("admin_orders.html", orders=orders, selected_status=status, selected_payment=payment, query=q)


@app.get(ADMIN_PATH + "/orders/<int:order_id>")
@admin_required
def admin_order_detail(order_id):
    order = get_db().execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order: abort(404)
    items = get_db().execute("SELECT * FROM order_items WHERE order_id=?", (order_id,)).fetchall()
    return render_template("admin_order_detail.html", order=order, items=items)


@app.post(ADMIN_PATH + "/orders/<int:order_id>/update")
@admin_required
def admin_order_update(order_id):
    order = get_db().execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order: abort(404)
    statuses = {"pending", "confirmed", "processing", "ready", "dispatched", "delivered", "cancelled"}
    pay_statuses = {"pending", "initiated", "paid", "failed", "refunded"}
    status = request.form.get("status", order["status"])
    payment = request.form.get("payment_status", order["payment_status"])
    if status not in statuses or payment not in pay_statuses:
        add_admin_notice("Choose a valid order and payment status.", "error")
        return redirect(url_for("admin_order_detail", order_id=order_id))
    db = get_db()
    db.execute("UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?", (status,payment,now_iso(),order_id))
    db.execute("INSERT INTO payment_events(order_no,provider_reference,status,payload,created_at) VALUES(?,?,?,?,?)", (order["order_no"], order["provider_reference"], "admin_update", json.dumps({"status":status,"payment_status":payment,"by":os.environ.get("ADMIN_USERNAME","admin")}), now_iso()))
    db.commit()
    add_admin_notice("Order status saved.", "success")
    return redirect(url_for("admin_order_detail", order_id=order_id))


@app.post(ADMIN_PATH + "/orders/<int:order_id>/retry-payment")
@admin_required
def admin_retry_payment(order_id):
    ok, message, link, _reference = initiate_provider_payment(order_id)
    add_admin_notice(("Payment request started: " if ok else "Payment not started: ") + message, "success" if ok else "error")
    return redirect(url_for("admin_order_detail", order_id=order_id))


@app.route(ADMIN_PATH + "/settings", methods=["GET", "POST"])
@admin_required
def admin_settings():
    db = get_db()
    if request.method == "POST":
        fields = list(DEFAULT_SETTINGS.keys())
        for key in fields:
            if key not in request.form:
                continue
            val = request.form.get(key, "").strip()[:2000]
            if key in {"primary_color", "accent_color", "page_bg"} and not re.fullmatch(r"#[0-9a-fA-F]{6}", val):
                val = DEFAULT_SETTINGS[key]
            db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key,val))
        for slug, title, _desc in CATEGORIES:
            value = request.form.get("category_" + slug, title).strip()[:80] or title
            db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (f"category:{slug}",value))
        db.commit()
        add_admin_notice("Store settings saved.", "success")
        return redirect(url_for("admin_settings"))
    payment_cfg = payment_env_status()
    return render_template("admin_settings.html", payment_cfg=payment_cfg)


@app.route(ADMIN_PATH + "/insights")
@admin_required
def admin_insights():
    db = get_db()
    since30 = (datetime.now(timezone.utc) - timedelta(days=30)).replace(microsecond=0).isoformat()
    top_searches = db.execute("SELECT query,COUNT(*) n FROM analytics WHERE event_type='search' AND created_at>=? AND query<>'' GROUP BY query ORDER BY n DESC LIMIT 30", (since30,)).fetchall()
    product_interest = db.execute("SELECT p.id,p.name,p.slug, SUM(CASE WHEN a.event_type='product_view' THEN 1 ELSE 0 END) views, SUM(CASE WHEN a.event_type='add_to_cart' THEN 1 ELSE 0 END) cart_adds, SUM(CASE WHEN a.event_type='whatsapp_click' THEN 1 ELSE 0 END) whatsapp_clicks FROM products p LEFT JOIN analytics a ON a.product_id=p.id AND a.created_at>=? GROUP BY p.id ORDER BY views DESC, cart_adds DESC LIMIT 30", (since30,)).fetchall()
    event_counts = db.execute("SELECT event_type,COUNT(*) n FROM analytics WHERE created_at>=? GROUP BY event_type ORDER BY n DESC", (since30,)).fetchall()
    daily = db.execute("SELECT substr(created_at,1,10) day, COUNT(*) visits FROM analytics WHERE event_type='page_view' AND created_at>=? GROUP BY substr(created_at,1,10) ORDER BY day", (since30,)).fetchall()
    referrals = db.execute("SELECT referral_code, COUNT(*) clicks, SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END) orders FROM analytics WHERE referral_code<>'' AND created_at>=? GROUP BY referral_code ORDER BY clicks DESC LIMIT 30", (since30,)).fetchall()
    return render_template("admin_insights.html", top_searches=top_searches, product_interest=product_interest, event_counts=event_counts, daily=daily, referrals=referrals)


@app.route(ADMIN_PATH + "/referrals", methods=["GET", "POST"])
@admin_required
def admin_referrals():
    db = get_db()
    if request.method == "POST":
        label = request.form.get("label", "Referral partner").strip()[:100] or "Referral partner"
        code = slugify(request.form.get("code", "").strip()).upper()[:50]
        if not code or code == "ITEM": code = "TRT-" + secrets.token_hex(3).upper()
        if db.execute("SELECT id FROM referral_codes WHERE code=?", (code,)).fetchone():
            add_admin_notice("That referral code already exists.", "error")
        else:
            db.execute("INSERT INTO referral_codes(code,label,created_at) VALUES(?,?,?)", (code,label,now_iso())); db.commit()
            add_admin_notice("Referral link created.", "success")
        return redirect(url_for("admin_referrals"))
    codes = db.execute("SELECT * FROM referral_codes ORDER BY id DESC").fetchall()
    return render_template("admin_referrals.html", codes=codes)


@app.post(ADMIN_PATH + "/referrals/<int:code_id>/toggle")
@admin_required
def admin_referral_toggle(code_id):
    row = get_db().execute("SELECT * FROM referral_codes WHERE id=?", (code_id,)).fetchone()
    if not row: abort(404)
    get_db().execute("UPDATE referral_codes SET active=? WHERE id=?", (0 if row["active"] else 1, code_id)); get_db().commit()
    return redirect(url_for("admin_referrals"))


@app.get("/api/admin/export/orders")
@admin_required
def admin_export_orders():
    import csv
    from io import StringIO
    rows = get_db().execute("SELECT order_no,customer_name,phone,email,address,city,subtotal,delivery_fee,total,status,payment_status,payment_method,provider_reference,referral_code,created_at FROM orders ORDER BY id DESC").fetchall()
    out = StringIO(); writer = csv.writer(out); writer.writerow(rows[0].keys() if rows else ["order_no","customer_name","phone","email","address","city","subtotal","delivery_fee","total","status","payment_status","payment_method","provider_reference","referral_code","created_at"])
    for row in rows: writer.writerow(list(row))
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = "attachment; filename=trt-orders.csv"
    return response


@app.get("/contact")
def contact_page():
    return render_template("contact.html")


@app.get("/about")
def about_page():
    return render_template("about.html")


@app.get("/delivery")
def shipping_page():
    return render_template("shipping.html")


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "TRT Furniture & Interiors", "database": DB_PATH.exists()})


@app.errorhandler(404)
def not_found(_err):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Not found."}), 404
    return render_template("error.html", code=404, message="We couldn’t find that page. The good pieces are still here."), 404


@app.errorhandler(400)
def bad_request(err):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": getattr(err, "description", "Bad request.")}), 400
    return render_template("error.html", code=400, message=getattr(err, "description", "Please refresh and try again.")), 400


@app.errorhandler(413)
def too_large(_err):
    return jsonify({"ok": False, "error": "Image upload is too large. Maximum is 8 MB."}), 413


# Initialise on import for Gunicorn and local execution.
init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
