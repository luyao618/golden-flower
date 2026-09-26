"""离线测试的 Provider SDK 边界：不导入真实 SDK，任何未替换的调用立即失败。"""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any


def install_provider_stub(attempts: list[str]) -> None:
    """必须在 app 导入前调用；测试仍可用 AsyncMock 验证传给 SDK 的参数。"""
    if "litellm" in sys.modules:
        raise RuntimeError("Install the offline provider boundary before importing app")
    module = ModuleType("litellm")

    async def forbidden_completion(*args: Any, **kwargs: Any) -> None:
        attempts.append("litellm.acompletion")
        raise AssertionError("Real providers are disabled in offline tests")

    module.acompletion = forbidden_completion
    sys.modules["litellm"] = module
