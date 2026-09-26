"""在临时工作目录中运行离线 pytest；显式禁用真实 Provider SDK 和外网访问。"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from pathlib import Path

from tests.harness.__main__ import deny_network, isolate_environment
from tests.harness.process import BACKEND
from tests.harness.providers import install_provider_stub


def main() -> int:
    """接受 pytest 参数（tests/ 路径相对 backend）；付费集成测试始终跳过。"""
    args = sys.argv[1:]
    has_test_path = False
    for i, argument in enumerate(args):
        path, *node = argument.split("::")
        if not argument.startswith("-") and (BACKEND / path).exists():
            args[i] = "::".join([str((BACKEND / path).resolve()), *node])
            has_test_path = True
    if not has_test_path:
        args.insert(0, str(BACKEND / "tests"))

    original = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="golden-flower-pytest-") as temporary:
        try:
            isolate_environment(Path(temporary))
            install_provider_stub([])
            sys.addaudithook(deny_network)
            import pytest

            class OfflineOnly:
                """即使用户显式选择 integration，也不运行真实模型测试。"""

                def pytest_collection_modifyitems(self, items: list[pytest.Item]) -> None:
                    for item in items:
                        if "integration" in item.keywords:
                            item.add_marker(pytest.mark.skip(reason="Offline runner: no providers"))

            return pytest.main(
                ["-c", str(BACKEND / "pyproject.toml"), *args], plugins=[OfflineOnly()],
            )
        finally:
            logging.shutdown()
            os.chdir(original)


if __name__ == "__main__":
    raise SystemExit(main())
