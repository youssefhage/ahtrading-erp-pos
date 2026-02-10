# Admin Desktop (Tauri)

This is a lightweight Tauri desktop wrapper for the Admin web app.

Goal: let accountants/managers run "Admin as an app" even when the **internet is down**,
as long as they can reach the on-prem edge machine over LAN (WiFi/router still on).

Important note:
- This does **not** replicate the database onto the laptop.
- If the laptop cannot reach the edge server (no LAN / edge off), Admin cannot function because the API/data is not reachable.

## Dev

1. Install Rust toolchain (once): https://rustup.rs
2. Install deps:
   - `cd /Users/Youssef/oDocuments/Business/Codex POS/apps/admin-desktop`
   - `npm i`
3. Run:
   - `npm run dev`

The app will ask you for an Admin URL like:
- `http://localhost:3000` (if you run Admin locally)
- `http://192.168.1.50:3000` (edge machine on LAN)

## Build

- `npm run build`

