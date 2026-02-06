#!/usr/bin/env python3
import json
import os
import sqlite3
import uuid
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import URLError

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'pos.sqlite')
SCHEMA_PATH = os.path.join(os.path.dirname(ROOT), 'pos', 'sqlite_schema.sql')
CONFIG_PATH = os.path.join(ROOT, 'config.json')
UI_PATH = os.path.join(ROOT, 'ui')

DEFAULT_CONFIG = {
    'api_base_url': 'http://localhost:8000',
    'company_id': '',
    'device_id': '',
    'device_token': '',
    'warehouse_id': '',
    'shift_id': '',
    'exchange_rate': 0,
    'rate_type': 'market',
    'pricing_currency': 'USD',
    'vat_rate': 0.11,
    'tax_code_id': None,
    'loyalty_rate': 0
}


def load_config():
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return {**DEFAULT_CONFIG, **data}


def save_config(data):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def db_connect():
    return sqlite3.connect(DB_PATH)


def init_db():
    if not os.path.exists(SCHEMA_PATH):
        raise RuntimeError(f"Missing schema file: {SCHEMA_PATH}")
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema = f.read()
    with db_connect() as conn:
        conn.executescript(schema)
        conn.commit()


def json_response(handler, payload, status=200):
    body = json.dumps(payload).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler, body, status=200, content_type='text/plain'):
    handler.send_response(status)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    handler.end_headers()
    handler.wfile.write(body.encode('utf-8'))


def file_response(handler, path):
    if not os.path.exists(path):
        handler.send_response(404)
        handler.end_headers()
        return
    ext = os.path.splitext(path)[1]
    ctype = 'text/plain'
    if ext == '.html':
        ctype = 'text/html'
    elif ext == '.css':
        ctype = 'text/css'
    elif ext == '.js':
        ctype = 'application/javascript'
    with open(path, 'rb') as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header('Content-Type', ctype)
    handler.end_headers()
    handler.wfile.write(data)


def fetch_json(url, headers=None):
    req = Request(url, headers=headers or {}, method='GET')
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))


def post_json(url, payload, headers=None):
    data = json.dumps(payload).encode('utf-8')
    req = Request(url, data=data, headers=headers or {}, method='POST')
    req.add_header('Content-Type', 'application/json')
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))


def device_headers(cfg):
    return {
        'X-Device-Id': cfg.get('device_id') or '',
        'X-Device-Token': cfg.get('device_token') or ''
    }


def get_items():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
                   p.price_usd, p.price_lbp
            FROM local_items_cache i
            LEFT JOIN (
              SELECT item_id, price_usd, price_lbp
              FROM local_prices_cache lp
              WHERE lp.effective_from = (
                SELECT MAX(effective_from) FROM local_prices_cache WHERE item_id = lp.item_id
              )
            ) p ON p.item_id = i.id
            ORDER BY i.sku
            """
        )
        return [dict(r) for r in cur.fetchall()]


def upsert_catalog(items):
    with db_connect() as conn:
        cur = conn.cursor()
        for it in items:
            cur.execute(
                """
                INSERT INTO local_items_cache (id, sku, barcode, name, unit_of_measure, tax_code_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  sku=excluded.sku,
                  barcode=excluded.barcode,
                  name=excluded.name,
                  unit_of_measure=excluded.unit_of_measure,
                  tax_code_id=excluded.tax_code_id,
                  updated_at=excluded.updated_at
                """,
                (
                    it.get('id'),
                    it.get('sku'),
                    it.get('barcode'),
                    it.get('name'),
                    it.get('unit_of_measure'),
                    None,
                    datetime.utcnow().isoformat(),
                ),
            )
            cur.execute(
                """
                INSERT INTO local_prices_cache (id, item_id, price_usd, price_lbp, effective_from, effective_to)
                VALUES (?, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                  item_id=excluded.item_id,
                  price_usd=excluded.price_usd,
                  price_lbp=excluded.price_lbp,
                  effective_from=excluded.effective_from,
                  effective_to=excluded.effective_to
                """,
                (
                    f"price-{it.get('id')}-{datetime.utcnow().date()}",
                    it.get('id'),
                    it.get('price_usd') or 0,
                    it.get('price_lbp') or 0,
                    datetime.utcnow().date().isoformat(),
                ),
            )
        conn.commit()


def add_outbox_event(event_type, payload):
    # Must be UUID to match Postgres `pos_events_outbox.id` type.
    event_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    with db_connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pos_outbox_events (event_id, event_type, payload_json, created_at, status)
            VALUES (?, ?, ?, ?, 'pending')
            """,
            (event_id, event_type, json.dumps(payload), created_at),
        )
        conn.commit()
    return event_id


def list_outbox():
    with db_connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_id, event_type, created_at, status
            FROM pos_outbox_events
            WHERE status = 'pending'
            ORDER BY created_at
            """
        )
        return [dict(r) for r in cur.fetchall()]


def mark_outbox_sent(event_ids):
    with db_connect() as conn:
        cur = conn.cursor()
        for eid in event_ids:
            cur.execute(
                "UPDATE pos_outbox_events SET status='acked' WHERE event_id = ?",
                (eid,),
            )
        conn.commit()


def build_sale_payload(cart, config, pricing_currency, exchange_rate, customer_id, payment_method, shift_id):
    lines = []
    total_usd = 0
    total_lbp = 0
    for item in cart:
        qty = item['qty']
        unit_price_usd = item.get('price_usd', 0)
        unit_price_lbp = item.get('price_lbp', 0)
        line_total_usd = unit_price_usd * qty
        line_total_lbp = unit_price_lbp * qty
        if line_total_lbp == 0 and exchange_rate:
            line_total_lbp = line_total_usd * exchange_rate
        total_usd += line_total_usd
        total_lbp += line_total_lbp
        lines.append({
            'item_id': item['id'],
            'qty': qty,
            'unit_price_usd': unit_price_usd,
            'unit_price_lbp': unit_price_lbp,
            'line_total_usd': line_total_usd,
            'line_total_lbp': line_total_lbp,
            'unit_cost_usd': 0,
            'unit_cost_lbp': 0
        })

    payments = []
    if payment_method == 'credit':
        payments.append({'method': 'credit', 'amount_usd': 0, 'amount_lbp': 0})
    else:
        if pricing_currency == 'USD':
            payments.append({'method': payment_method or 'cash', 'amount_usd': total_usd, 'amount_lbp': 0})
        else:
            payments.append({'method': payment_method or 'cash', 'amount_usd': 0, 'amount_lbp': total_lbp})

    tax_block = None
    if config.get('tax_code_id') and config.get('vat_rate'):
        base_lbp = total_lbp
        tax_lbp = base_lbp * float(config.get('vat_rate'))
        tax_block = {
            'tax_code_id': config.get('tax_code_id'),
            'base_usd': total_usd,
            'base_lbp': base_lbp,
            'tax_usd': 0,
            'tax_lbp': tax_lbp,
            'tax_date': datetime.utcnow().date().isoformat()
        }

    loyalty_rate = float(config.get('loyalty_rate') or 0)
    loyalty_points = total_usd * loyalty_rate if loyalty_rate > 0 else 0

    return {
        'invoice_no': None,
        'exchange_rate': exchange_rate,
        'pricing_currency': pricing_currency,
        'settlement_currency': pricing_currency,
        'customer_id': customer_id,
        'warehouse_id': config.get('warehouse_id'),
        'shift_id': shift_id,
        'lines': lines,
        'tax': tax_block,
        'payments': payments,
        'loyalty_points': loyalty_points
    }


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api_get(parsed)
            return
        path = parsed.path
        if path == '/':
            path = '/index.html'
        file_path = os.path.join(UI_PATH, path.lstrip('/'))
        file_response(self, file_path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api_post(parsed)
            return
        text_response(self, 'Not found', status=404)

    def read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode('utf-8')
        return json.loads(raw)

    def handle_api_get(self, parsed):
        if parsed.path == '/api/health':
            json_response(self, {'ok': True})
            return
        if parsed.path == '/api/config':
            json_response(self, load_config())
            return
        if parsed.path == '/api/items':
            json_response(self, {'items': get_items()})
            return
        if parsed.path == '/api/outbox':
            json_response(self, {'outbox': list_outbox()})
            return
        json_response(self, {'error': 'not found'}, status=404)

    def handle_api_post(self, parsed):
        if parsed.path == '/api/config':
            data = self.read_json()
            cfg = load_config()
            cfg.update(data)
            save_config(cfg)
            json_response(self, {'ok': True, 'config': cfg})
            return

        if parsed.path == '/api/sale':
            data = self.read_json()
            cfg = load_config()
            cart = data.get('cart', [])
            if not cart:
                json_response(self, {'error': 'empty cart'}, status=400)
                return
            exchange_rate = data.get('exchange_rate') or cfg.get('exchange_rate') or 0
            pricing_currency = data.get('pricing_currency') or cfg.get('pricing_currency') or 'USD'
            customer_id = data.get('customer_id')
            payment_method = data.get('payment_method') or 'cash'
            shift_id = data.get('shift_id') or cfg.get('shift_id') or None
            payload = build_sale_payload(cart, cfg, pricing_currency, float(exchange_rate), customer_id, payment_method, shift_id)
            event_id = add_outbox_event('sale.completed', payload)
            json_response(self, {'event_id': event_id})
            return

        if parsed.path == '/api/sync/pull':
            cfg = load_config()
            base = cfg.get('api_base_url')
            company_id = cfg.get('company_id')
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                headers = device_headers(cfg)
                catalog = fetch_json(f"{base}/pos/catalog?company_id={company_id}", headers=headers)
                upsert_catalog(catalog.get('items', []))
                rate = fetch_json(f"{base}/pos/exchange-rate", headers=headers)
                if rate.get('rate'):
                    cfg['exchange_rate'] = rate['rate']['usd_to_lbp']
                    save_config(cfg)
                json_response(self, {'ok': True, 'items': len(catalog.get('items', []))})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/status':
            cfg = load_config()
            base = cfg.get('api_base_url')
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                res = fetch_json(f"{base}/pos/shifts/open", headers=device_headers(cfg))
                shift = res.get('shift')
                cfg['shift_id'] = shift['id'] if shift else ''
                save_config(cfg)
                json_response(self, {'shift': shift})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/open':
            cfg = load_config()
            base = cfg.get('api_base_url')
            data = self.read_json()
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                res = post_json(f"{base}/pos/shifts/open", data, headers=device_headers(cfg))
                shift = res.get('shift')
                if shift:
                    cfg['shift_id'] = shift['id']
                    save_config(cfg)
                json_response(self, {'shift': shift})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/shift/close':
            cfg = load_config()
            base = cfg.get('api_base_url')
            data = self.read_json()
            shift_id = cfg.get('shift_id')
            if not shift_id:
                json_response(self, {'error': 'no open shift'}, status=400)
                return
            if not cfg.get('device_id') or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            try:
                res = post_json(f"{base}/pos/shifts/{shift_id}/close", data, headers=device_headers(cfg))
                cfg['shift_id'] = ''
                save_config(cfg)
                json_response(self, {'shift': res.get('shift')})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        if parsed.path == '/api/sync/push':
            cfg = load_config()
            base = cfg.get('api_base_url')
            company_id = cfg.get('company_id')
            device_id = cfg.get('device_id')
            if not device_id or not cfg.get('device_token'):
                json_response(self, {'error': 'missing device_id or device_token'}, status=400)
                return
            events = []
            with db_connect() as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT event_id, event_type, payload_json, created_at
                    FROM pos_outbox_events
                    WHERE status = 'pending'
                    ORDER BY created_at
                    """
                )
                rows = cur.fetchall()
                for r in rows:
                    events.append({
                        'event_id': r['event_id'],
                        'event_type': r['event_type'],
                        'payload': json.loads(r['payload_json']),
                        'created_at': r['created_at']
                    })
            if not events:
                json_response(self, {'ok': True, 'sent': 0})
                return
            payload = {
                'company_id': company_id,
                'device_id': device_id,
                'events': events
            }
            try:
                res = post_json(f"{base}/pos/outbox/submit", payload, headers=device_headers(cfg))
                accepted = res.get('accepted', [])
                if accepted:
                    mark_outbox_sent(accepted)
                json_response(self, {'ok': True, 'sent': len(accepted), 'rejected': res.get('rejected', [])})
            except URLError as ex:
                json_response(self, {'error': str(ex)}, status=502)
            return

        json_response(self, {'error': 'not found'}, status=404)


if __name__ == '__main__':
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', 7070), Handler)
    print('POS Agent running on http://localhost:7070')
    server.serve_forever()
