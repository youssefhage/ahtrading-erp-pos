import os
import sys


# Allow running pytest from either the repo root or from within `backend/`.
# Tests import `backend.*`, which requires the repo root on sys.path.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

