"""验证重连重叠时旧连接退出不会清理新连接。"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.game_store import GameStore
from app.api.websocket import WebSocketManager, websocket_endpoint
from app.engine.game_manager import create_game


@pytest.mark.asyncio
@pytest.mark.parametrize("buffered_action", [False, True])
async def test_old_endpoint_finally_preserves_replacement(buffered_action: bool) -> None:
    """旧端点在新连接注册后进入 finally，新端点仍能收到状态和广播。"""
    manager = WebSocketManager()
    store = GameStore()
    game = create_game([
        {"name": "玩家", "player_type": "human"},
        {"name": "AI", "player_type": "ai", "model_id": "test-model"},
    ])
    store.put(game)
    player_id = game.players[0].id
    old_socket = AsyncMock()
    new_socket = AsyncMock()
    old_socket.query_params = {}
    new_socket.query_params = {}
    receiving_old = asyncio.Event()
    receiving_new = asyncio.Event()
    retired = asyncio.Event()
    finish_close = asyncio.Event()
    old_messages: asyncio.Queue = asyncio.Queue()
    new_messages: asyncio.Queue = asyncio.Queue()

    async def receive_old() -> dict:
        receiving_old.set()
        await old_messages.get()
        if buffered_action:
            return {"type": "player_action", "data": {"action": "call"}}
        raise WebSocketDisconnect(code=4001)

    async def receive_new() -> dict:
        receiving_new.set()
        await new_messages.get()
        raise WebSocketDisconnect()

    async def close_old(*, code: int, reason: str) -> None:
        old_messages.put_nowait(None)
        retired.set()
        await finish_close.wait()

    old_socket.receive_json.side_effect = receive_old
    new_socket.receive_json.side_effect = receive_new
    old_socket.close.side_effect = close_old
    tasks: list[asyncio.Task] = []
    with (
        patch("app.api.websocket.get_ws_manager", return_value=manager),
        patch("app.api.websocket.get_game_store", return_value=store),
    ):
        try:
            old_task = asyncio.create_task(websocket_endpoint(old_socket, game.game_id, player_id))
            tasks.append(old_task)
            await asyncio.wait_for(receiving_old.wait(), timeout=2)
            new_task = asyncio.create_task(websocket_endpoint(new_socket, game.game_id, player_id))
            tasks.append(new_task)
            await asyncio.wait_for(retired.wait(), timeout=2)
            await asyncio.wait_for(old_task, timeout=2)
            assert manager.get_connections(game.game_id)[player_id] is new_socket
            old_socket.close.assert_awaited_once_with(code=4001, reason="Connection replaced")
            finish_close.set()
            await asyncio.wait_for(receiving_new.wait(), timeout=2)
            assert new_socket.send_json.call_args_list[0].args[0]["type"] == "game_state"
            event = {"type": "turn_changed", "data": {"current_player_id": player_id}}
            await manager.send_to_player(game.game_id, player_id, event)
            new_socket.send_json.assert_awaited_with(event)
            await manager.broadcast(game.game_id, event)
            assert new_socket.send_json.await_count == 3
            assert old_socket.send_json.await_count == 1
            new_messages.put_nowait(None)
            await asyncio.wait_for(new_task, timeout=2)
            assert manager.get_connections(game.game_id) == {}
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_replacement_survives_already_closed_socket() -> None:
    """关闭旧连接失败也保留新连接，旧连接的重复清理不影响它。"""
    manager = WebSocketManager()
    old_socket = AsyncMock()
    new_socket = AsyncMock()
    await manager.connect("game", "player", old_socket)
    old_socket.close.side_effect = RuntimeError("already closed")
    await manager.connect("game", "player", new_socket)
    manager.disconnect("game", "player", old_socket)
    manager.disconnect("game", "player", old_socket)
    assert manager.get_connections("game")["player"] is new_socket
    manager.disconnect("game", "player", new_socket)
    assert manager.active_game_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [4001, 4003, 4004])
async def test_terminal_close_codes_reach_browser(code: int) -> None:
    """先完成握手再发送终止码，避免浏览器只收到可重试的 1006。"""
    manager = WebSocketManager()
    store = GameStore()
    game = create_game([
        {"name": "玩家", "player_type": "human"},
        {"name": "AI", "player_type": "ai", "model_id": "test-model"},
    ])
    if code != 4004:
        store.put(game)
    socket = AsyncMock()
    socket.query_params = {}
    player_id = None if code == 4001 else "invalid-player"
    sequence: list[str] = []

    async def accept() -> None:
        sequence.append("accept")

    async def close(*, code: int, reason: str) -> None:
        sequence.append("close")

    socket.accept.side_effect = accept
    socket.close.side_effect = close
    with (
        patch("app.api.websocket.get_ws_manager", return_value=manager),
        patch("app.api.websocket.get_game_store", return_value=store),
    ):
        await websocket_endpoint(socket, game.game_id, player_id)
    assert sequence == ["accept", "close"]
    assert socket.close.call_args.kwargs["code"] == code
    assert manager.active_game_count == 0
