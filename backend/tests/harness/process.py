"""pytest 使用的服务进程管理；只清理自身创建的进程和临时文件。"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

BACKEND = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Harness:
    url: str
    directory: Path
    process: subprocess.Popen


@contextmanager
def running_backend(port: int = 0) -> Iterator[Harness]:
    """端口 0 由系统分配并一直持有；退出、异常和启动失败均有有界清理。"""
    with tempfile.TemporaryDirectory(prefix="golden-flower-harness-") as temporary:
        root = Path(temporary)
        ready_file = root / "ready.json"
        with (root / "server.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen(
                [
                    sys.executable, "-m", "tests.harness", "--port", str(port),
                    "--ready-file", str(ready_file),
                ],
                cwd=BACKEND,
                stdin=subprocess.PIPE,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                deadline = time.monotonic() + 30
                while not ready_file.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        log.seek(0)
                        raise RuntimeError(f"Harness startup failed:\n{log.read()}")
                    time.sleep(0.05)
                ready = json.loads(ready_file.read_text(encoding="utf-8"))
                yield Harness(ready["url"], Path(ready["directory"]), process)
            finally:
                if process.stdin:
                    process.stdin.close()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if process.returncode != 0:
                log.seek(0)
                raise RuntimeError(f"Harness exited with {process.returncode}:\n{log.read()}")
