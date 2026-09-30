"""Write the app's OpenAPI document to backend/openapi.json (run from backend/)."""

import json
import os
import sys
from pathlib import Path

# Fake mode: exporting the schema must never need secrets.
os.environ.setdefault("IRIS_ENV", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def render() -> str:
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    OUTPUT.write_text(render(), encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
