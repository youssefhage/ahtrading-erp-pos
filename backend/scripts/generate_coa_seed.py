#!/usr/bin/env python3
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs' / 'coa' / 'coa_lebanon_template.json'
OUTPUT = ROOT / 'backend' / 'db' / 'seeds' / 'seed_coa_lebanon.sql'

NAMESPACE = uuid.UUID('3b8b8c6a-2c52-4d7c-9e3f-b1a11b2f2d88')
TEMPLATE_ID = uuid.uuid5(NAMESPACE, 'LB_COA_2025')

with SOURCE.open('r', encoding='utf-8') as f:
    payload = json.load(f)

accounts = payload['accounts']

def sql_escape(value: str) -> str:
    return value.replace("'", "''")

lines = []
lines.append('-- Seed Lebanese COA Template')
lines.append('BEGIN;')
lines.append(
    "INSERT INTO coa_templates (id, code, name, description, default_language) VALUES ("\
    f"'{TEMPLATE_ID}', '{sql_escape(payload['template_code'])}', '{sql_escape(payload['template_name'])}', "\
    f"'Imported from Excel', '{sql_escape(payload.get('default_language','en'))}') "\
    "ON CONFLICT (code) DO NOTHING;"
)

for acc in accounts:
    acc_id = uuid.uuid5(NAMESPACE, f"LB_COA_2025::{acc['account_code']}")
    normal_balance_raw = acc.get('normal_balance_raw', '')
    is_postable = normal_balance_raw not in {'C=D','HD','N.A'}
    lines.append(
        "INSERT INTO coa_template_accounts (id, template_id, account_code, name_ar, name_en, name_fr, normal_balance_raw, is_postable_default) VALUES ("\
        f"'{acc_id}', '{TEMPLATE_ID}', '{sql_escape(acc['account_code'])}', "\
        f"'{sql_escape(acc.get('name_ar',''))}', '{sql_escape(acc.get('name_en',''))}', '{sql_escape(acc.get('name_fr',''))}', "\
        f"'{sql_escape(normal_balance_raw)}', {'true' if is_postable else 'false'}) "\
        "ON CONFLICT (template_id, account_code) DO NOTHING;"
    )

lines.append('COMMIT;')

OUTPUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'Wrote {OUTPUT} with {len(accounts)} accounts')
