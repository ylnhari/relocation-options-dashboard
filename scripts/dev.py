"""Start Wayfinder on a deterministic, loopback-only project port."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from portlib import PortError, resolve_port  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    try:
        port = resolve_port(
            "relocation-options-dashboard",
            explicit=args.port,
            env_var="WAYFINDER_PORT",
            default=8780,
            start=ROOT,
        )
    except PortError as exc:
        print(exc, file=sys.stderr)
        return 2

    npm = "npm.cmd" if os.name == "nt" else "npm"
    env = os.environ.copy()
    env.setdefault("WRANGLER_LOG_PATH", ".wrangler/wrangler.log")
    command = [npm, "run", "dev", "--", "--port", str(port)]
    print(f"Wayfinder: http://127.0.0.1:{port}")
    return subprocess.call(command, cwd=ROOT, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
