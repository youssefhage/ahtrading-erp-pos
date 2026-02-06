# Full System Map

## 1) Core Data Domains
- Company, Branch, Users, Roles
- COA Templates + Company COA
- General Ledger + Journals
- Items + Inventory + Stock Moves
- Sales + POS + Payments
- Purchasing + Supplier Invoices
- Tax/VAT
- Intercompany
- AI Agents

## 2) Operational Flows
### Sales (POS)
- Create sale (offline) → outbox event → server posts invoice → GL entry → stock move

### Purchasing
- PO → Goods Receipt → Supplier Invoice → Payment → GL entry → stock move

### Inventory
- Stock move triggers valuation + COGS

### Intercompany
- Sale in A + issue from B → intercompany settlement

## 3) AI Automation Loop
- Events → AI decision → recommend/execute → audit log
 - AI tables: events, ai_recommendations, ai_actions

## 4) Offline Sync Loop
- Device outbox → server ingestion → document creation
- Server inbox → device updates (prices, promotions, items)

## 5) Reporting
- Company-level financials
- VAT reports (LBP)
- Consolidated dashboards (optional)
