# Apps Directory Guide

## Purpose
This folder contains application entry points and wrappers.

## Folders
- `admin`:
  Main ERP web application (Next.js).
- `pos-desktop`:
  Tauri desktop wrapper for POS distribution, updater, and installers.
- `admin-desktop`:
  Tauri wrapper for Admin web app usage as desktop app.
- `downloads`:
  Public download assets/build output support.
- `pos-web`:
  Web-hosted POS deployment scaffolding.

## Edit Guidance
- POS cashier UI changes:
  Edit `../pos-desktop/ui/src` (shared by web and desktop).
- POS desktop packaging/version changes:
  Edit `pos-desktop`.
- Admin ERP feature changes:
  Edit `admin`.
