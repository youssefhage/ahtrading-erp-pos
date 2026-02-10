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

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = []
hiddenimports += collect_submodules("bcrypt")

datas = []
datas += [("pos-desktop/ui", "ui")]
datas += [("pos/sqlite_schema.sql", ".")]

a = Analysis(
    ["pos-desktop/agent.py"],
    pathex=["."],
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

