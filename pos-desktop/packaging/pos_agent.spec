# PyInstaller spec for building the POS agent into a single self-contained binary.
#
# This bundles:
# - pos-desktop/agent.py
# - pos-desktop/ui (HTML/JS/CSS)
# - pos/sqlite_schema.sql (as sqlite_schema.sql at bundle root)
#
# Build example:
#   python3 -m pip install pyinstaller bcrypt
#   pyinstaller --noconfirm pos-desktop/packaging/pos_agent.spec

# -*- mode: python ; coding: utf-8 -*-

import os
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None
SPEC_PATH = os.path.abspath(globals().get("SPEC", "pos-desktop/packaging/pos_agent.spec"))
SPEC_DIR = os.path.dirname(SPEC_PATH)
REPO_ROOT = os.path.abspath(os.path.join(SPEC_DIR, "..", ".."))
if not os.path.exists(os.path.join(REPO_ROOT, "pos-desktop", "agent.py")):
    REPO_ROOT = os.path.abspath(os.getcwd())

hiddenimports = []
hiddenimports += collect_submodules("bcrypt")

datas = []
# Bundle only the built UI (keeps binaries small; avoids node_modules).
ui_dist = os.path.join(REPO_ROOT, "pos-desktop", "ui", "dist")
if os.path.exists(ui_dist):
    datas += [(ui_dist, os.path.join("ui", "dist"))]
else:
    print(f"[pos-agent] warning: UI dist missing: {ui_dist} (building without UI)")
datas += [(os.path.join(REPO_ROOT, "pos", "sqlite_schema.sql"), ".")]

a = Analysis(
    [os.path.join(REPO_ROOT, "pos-desktop", "agent.py")],
    pathex=[REPO_ROOT],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="pos-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
