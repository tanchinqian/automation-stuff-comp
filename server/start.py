#!/usr/bin/env python3
"""Start the local pipeline API server.

Checks the required packages, installs them if missing, then launches uvicorn
with auto-reload on port 8000.

Run with:
  python server/start.py
"""
import importlib
import subprocess
import sys
from pathlib import Path

# packages the server needs
REQUIRED = ["fastapi", "uvicorn", "multipart", "google.genai", "dotenv"]

ROOT = Path(__file__).resolve().parents[1]
PORT = 8000


def ensure_packages():
    """Install any missing dependency, then confirm all imports work."""
    missing = []
    for mod in REQUIRED:
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(mod)

    if missing:
        # map import names to their pip package names
        pip_names = []
        for m in missing:
            if m == "multipart":
                pip_names.append("python-multipart")
            elif m == "dotenv":
                pip_names.append("python-dotenv")
            elif m == "google.genai":
                pip_names.append("google-genai")
            else:
                pip_names.append(m)
        print(f"Installing missing packages: {', '.join(pip_names)}")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", *pip_names])
    else:
        print("All server dependencies are installed.")


def main():
    ensure_packages()

    print()
    print(f"Server running at http://localhost:{PORT}")
    print("Start your frontend with: npm run dev")
    print(f"Then open http://localhost:5173")
    print("(Ctrl+C to stop)")

    # run from the repo root so 'server.app:app' resolves
    subprocess.run(
        [sys.executable, "-m", "uvicorn", "server.app:app",
         "--reload", "--port", str(PORT)],
        cwd=str(ROOT),
    )


if __name__ == "__main__":
    main()
