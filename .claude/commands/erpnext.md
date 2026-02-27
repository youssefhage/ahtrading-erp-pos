# ERPNext API Connection — AH Age Trading

You are connected to the ERPNext instance for **AH Age Trading**.

## Connection Details

- **Base URL:** `https://erp.ahagetrading.com`
- **API Key:** `c9ef7b730779b26`
- **API Secret:** `fa115e4da0189a8`
- **Auth Header:** `Authorization: token c9ef7b730779b26:fa115e4da0189a8`

## How to Make API Calls

Use `curl` via the Bash tool with the authorization header. Always use this pattern:

```bash
curl -s -X GET "https://erp.ahagetrading.com/api/resource/{DocType}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8" \
  -H "Content-Type: application/json"
```

### Common API Patterns

**List documents (with filters, pagination):**
```bash
curl -s "https://erp.ahagetrading.com/api/resource/{DocType}?filters=[[\"{DocType}\",\"{field}\",\"=\",\"{value}\"]]&fields=[\"name\",\"field1\",\"field2\"]&limit_page_length=20&order_by=creation desc" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8"
```

**Get a single document:**
```bash
curl -s "https://erp.ahagetrading.com/api/resource/{DocType}/{name}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8"
```

**Create a document:**
```bash
curl -s -X POST "https://erp.ahagetrading.com/api/resource/{DocType}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8" \
  -H "Content-Type: application/json" \
  -d '{"field1": "value1", "field2": "value2"}'
```

**Update a document:**
```bash
curl -s -X PUT "https://erp.ahagetrading.com/api/resource/{DocType}/{name}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8" \
  -H "Content-Type: application/json" \
  -d '{"field1": "new_value"}'
```

**Call a whitelisted server method:**
```bash
curl -s -X POST "https://erp.ahagetrading.com/api/method/{dotted.method.path}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8" \
  -H "Content-Type: application/json" \
  -d '{"arg1": "value1"}'
```

**Get report data:**
```bash
curl -s "https://erp.ahagetrading.com/api/method/frappe.client.get_report?report_name={ReportName}&filters={}" \
  -H "Authorization: token c9ef7b730779b26:fa115e4da0189a8"
```

## Key DocTypes

Common ERPNext DocTypes you may query:
- `Item`, `Item Price`, `Item Group`
- `Customer`, `Supplier`
- `Sales Order`, `Sales Invoice`, `Delivery Note`
- `Purchase Order`, `Purchase Invoice`, `Purchase Receipt`
- `Stock Entry`, `Stock Ledger Entry`
- `Payment Entry`, `Journal Entry`
- `Warehouse`, `Bin` (stock levels)
- `POS Invoice`, `POS Profile`
- `Employee`, `Salary Slip`

## Instructions

When the user invokes `/erpnext`, respond to their request by:

1. Determine what ERPNext data or action they need
2. Make the appropriate API call(s) using curl
3. Parse and present the results clearly
4. If the user provides arguments (e.g., `/erpnext list all customers`), act on those immediately

If no specific request is given, ask the user what they'd like to do with ERPNext (e.g., look up data, create records, run reports).

$ARGUMENTS
