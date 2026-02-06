# AH Trading ERP/POS Requirements (Finalized)

## Business Context
- FMCG wholesale + retail business inspired by Costco.
- Operates in Lebanon with dual currency (USD + LBP) critical to all operations.
- Two companies today; must scale to multiple companies later.
- One warehouse currently; possible multi-warehouse later.
- Internet is unreliable; offline-first is mandatory.

## Financial + Regulatory
- USD is primary pricing and settlement currency for most items.
- LBP is mandatory for VAT and local reporting.
- Dual-currency bookkeeping required for every transaction.
- Official tax reporting required (Lebanese VAT).
- Support Lebanese COA + IFRS-style COA + custom COA templates.
- COA supports Arabic/English/French labels.

## Operational
- POS desktop must run on 4 GB RAM hardware.
- POS must never block on internet outages.
- Must support rare cross-company issuing (sell in A, issue from B).
- Strict separation of company data at all layers.

## AI and Automation
- System is modular and agent-driven.
- AI agents can recommend or auto-execute based on configuration.
- Human approval required for high-risk actions.

## Non-Functional
- Fast POS transaction time (<2s offline).
- Safe sync with full audit logs.
- Idempotent events and reconciliation.
- Role-based access control with least privilege.
