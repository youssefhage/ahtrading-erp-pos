# POS Tauri Wrapper (Optional)

Use this if you want a native desktop shell on Windows/macOS/Linux.

## Approach
- Run `pos-desktop/agent.py` as the local backend/UI server.
- Tauri embeds `http://localhost:7070` in a native window.

## Recommended
- Keep Python agent as the core for offline operations.
- Add Tauri wrapper only for convenience or kiosk mode.
