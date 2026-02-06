# AI Agent Architecture

## Core Concept
Agents consume business events and propose or execute actions within configured limits.

## Event Stream
- sales.created
- sales.returned
- inventory.low_stock
- purchase.received
- customer.inactive
- price.change

## Agent Catalog
### AI Purchase
- Monitors stock levels, lead times, and demand history.
- Suggests reorder quantities and supplier selection.

### AI Sales/CRM
- Detects customer churn risk.
- Suggests follow-up or discount offers.

### AI Inventory
- Flags shrinkage anomalies and slow movers.
- Recommends stock transfers and markdowns.

### AI Fulfillment
- Optimizes pick lists and delivery batches.
- Suggests routing improvements.

## Auto-Execute Controls
- Per-agent toggle: recommend-only or auto-execute.
- Thresholds by amount, risk, and frequency.
- Approval workflow for high-risk actions.

## Safety
- Every AI action is logged.
- Reversible actions preferred.
- Human override always available.
