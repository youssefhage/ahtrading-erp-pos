# Tech Stack Proposal

## Backend
- Language: Node.js (Fastify) or Python (FastAPI)
- Database: PostgreSQL (RLS for company isolation)
- Cache/Queue: Redis
- Background Jobs: Worker pool (BullMQ/Celery)

## POS Desktop
- Framework: Tauri (lightweight) or minimal Electron
- Local DB: SQLite

## Web App
- Frontend: React or Svelte
- UI: Minimal POS mode + full admin mode

## AI Layer
- Separate worker services
- Access via internal APIs only (no direct DB writes)
- Event-driven processing

## Deployment
- On-Prem Linux server as primary
- Optional cloud sync for backups and remote access
- VPN access for external users
