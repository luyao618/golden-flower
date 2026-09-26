"""仅供测试的独立服务入口；不经过产品启动脚本或真实 Provider。"""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import logging
import os
import socket
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

blocked_network: list[str] = []


def isolate_environment(directory: Path) -> None:
    """只保留启动所需环境，避开工作区 .env、Provider 密钥和外部数据库。"""
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    os.environ.clear()
    os.environ.update(environment)
    os.environ.update(
        DATABASE_URL=f"sqlite+aiosqlite:///{(directory / 'harness.sqlite3').as_posix()}",
        LITELLM_LOCAL_MODEL_COST_MAP="True",
        DO_NOT_TRACK="1",
        LOG_LEVEL="WARNING",
    )
    os.chdir(directory)


def deny_network(event: str, args: tuple[Any, ...]) -> None:
    """阻止外网连接和 DNS，允许事件循环在 Windows 上创建 loopback socketpair。"""
    if event == "socket.connect":
        sock, address = args
        if sock.family == getattr(socket, "AF_UNIX", None):
            return
        if isinstance(address, tuple):
            try:
                if ipaddress.ip_address(address[0]).is_loopback:
                    return
            except ValueError:
                pass
    elif event in {"socket.getaddrinfo", "socket.gethostbyname"}:
        try:
            if ipaddress.ip_address(args[0]).is_loopback:
                return
        except ValueError:
            pass
    if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname"}:
        # 不包含地址或凭据；audit hook 在系统调用前阻止请求。
        blocked_network.append(event)
        raise RuntimeError(f"Harness forbids outbound network: {event}")


async def serve(listener: socket.socket, ready_file: Path, directory: Path) -> None:
    """复用已绑定的端口，生命周期完成后公布地址；stdin EOF 请求正常退出。"""
    import uvicorn

    from tests.harness.providers import install_provider_stub

    provider_attempts: list[str] = []
    install_provider_stub(provider_attempts)
    from tests.harness.application import create_harness_app

    application = create_harness_app(directory, blocked_network, provider_attempts)
    server = uvicorn.Server(
        uvicorn.Config(
            application,
            log_level="warning",
            access_log=False,
            loop="asyncio",
            timeout_graceful_shutdown=5,
        )
    )

    def stop_on_input() -> None:
        sys.stdin.readline()
        server.should_exit = True

    threading.Thread(target=stop_on_input, daemon=True).start()
    task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        while not server.started:
            if task.done():
                await task
                raise RuntimeError("Harness stopped before becoming ready")
            await asyncio.sleep(0.02)
        port = listener.getsockname()[1]
        temporary = ready_file.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"url": f"http://127.0.0.1:{port}", "directory": str(directory)}),
            encoding="utf-8",
        )
        temporary.replace(ready_file)
        await task
    finally:
        server.should_exit = True
        await task
        ready_file.unlink(missing_ok=True)


def main() -> None:
    """绑定 loopback 专用端口；端口被占用时直接失败，不复用或终止其它服务。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, type=int, help="0 lets the OS reserve a free port")
    parser.add_argument("--ready-file", required=True, type=Path)
    args = parser.parse_args()
    ready_file = args.ready_file.resolve()
    if ready_file.exists():
        parser.error("ready-file must not already exist")
    original_directory = Path.cwd()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", args.port))
        listener.listen(128)
        listener.setblocking(False)
        with tempfile.TemporaryDirectory(prefix="backend-", dir=ready_file.parent) as temporary:
            directory = Path(temporary)
            try:
                isolate_environment(directory)
                sys.addaudithook(deny_network)
                asyncio.run(serve(listener, ready_file, directory))
            finally:
                logging.shutdown()
                os.chdir(original_directory)


if __name__ == "__main__":
    main()
