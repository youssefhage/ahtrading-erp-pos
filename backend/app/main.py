from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from .routers.pos import router as pos_router
from .routers.companies import router as companies_router
from .routers.branches import router as branches_router
from .routers.warehouses import router as warehouses_router
from .routers.config import router as config_router
from .routers.items import router as items_router
from .routers.item_categories import router as item_categories_router
from .routers.inventory import router as inventory_router
from .routers.sales import router as sales_router
from .routers.purchases import router as purchases_router
from .routers.reports import router as reports_router
from .routers.ai import router as ai_router
from .routers.suppliers import router as suppliers_router
from .routers import party_addresses
from .routers.attachments import router as attachments_router
from .routers.customers import router as customers_router
from .routers.intercompany import router as intercompany_router
from .routers.users import router as users_router
from .routers.coa import router as coa_router
from .routers.accounting import router as accounting_router
from .routers.banking import router as banking_router
from .routers.pricing import router as pricing_router
from .routers.promotions import router as promotions_router
from .routers.auth import router as auth_router
from .config import settings
from .deps import require_company_access

app = FastAPI(title="AH Trading ERP/POS API", version="0.1.0")

# Dev CORS: Admin app runs on a different port during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pos_router)
app.include_router(auth_router)
app.include_router(companies_router)
app.include_router(branches_router, dependencies=[Depends(require_company_access)])
app.include_router(warehouses_router, dependencies=[Depends(require_company_access)])
app.include_router(config_router, dependencies=[Depends(require_company_access)])
app.include_router(items_router, dependencies=[Depends(require_company_access)])
app.include_router(item_categories_router, dependencies=[Depends(require_company_access)])
app.include_router(inventory_router, dependencies=[Depends(require_company_access)])
app.include_router(sales_router, dependencies=[Depends(require_company_access)])
app.include_router(purchases_router, dependencies=[Depends(require_company_access)])
app.include_router(reports_router, dependencies=[Depends(require_company_access)])
app.include_router(ai_router, dependencies=[Depends(require_company_access)])
app.include_router(suppliers_router, dependencies=[Depends(require_company_access)])
app.include_router(customers_router, dependencies=[Depends(require_company_access)])
app.include_router(party_addresses.router, dependencies=[Depends(require_company_access)])
app.include_router(attachments_router, dependencies=[Depends(require_company_access)])
app.include_router(intercompany_router, dependencies=[Depends(require_company_access)])
app.include_router(users_router, dependencies=[Depends(require_company_access)])
app.include_router(coa_router, dependencies=[Depends(require_company_access)])
app.include_router(accounting_router, dependencies=[Depends(require_company_access)])
app.include_router(banking_router, dependencies=[Depends(require_company_access)])
app.include_router(pricing_router, dependencies=[Depends(require_company_access)])
app.include_router(promotions_router, dependencies=[Depends(require_company_access)])

@app.get("/health")
def health():
    return {
        "status": "ok",
        "env": settings.env,
    }

@app.get("/meta")
def meta():
    return {
        "service": "ahtrading-backend",
        "version": app.version,
    }
