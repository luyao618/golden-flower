"""2E：真实 HTTP/WebSocket、临时 SQLite 和可独立运行的后端缺陷复现。"""

from __future__ import annotations

import json
import socket
import sqlite3
import subprocess
import sys
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
import pytest
from websockets.sync.client import ClientConnection, connect

from app.engine.deck import Deck
from app.engine.game_manager import apply_action, create_game, start_round
from app.models.game import GameAction, GameConfig, GamePhase
from tests.harness.process import BACKEND, running_backend

MODEL_ID = "harness-call-then-fold"


def receive_until(ws: ClientConnection, event_type: str) -> list[dict[str, Any]]:
    """等待实际事件；统一截止时间避免丢事件时测试永久阻塞。"""
    deadline = time.monotonic() + 10
    events = []
    while time.monotonic() < deadline:
        event = json.loads(ws.recv(timeout=max(0.01, deadline - time.monotonic())))
        assert event["type"] not in {"error", "copilot_error"}, event
        events.append(event)
        if event["type"] == event_type:
            return events
    raise AssertionError(f"No {event_type}; received {events}")


def test_real_create_connect_action_settlement_and_reads() -> None:
    """真实路由、AI 调度和持久化互通；结算顺序、余额、重连及下一局均可观察。"""
    with (
        running_backend() as backend,
        httpx.Client(base_url=backend.url, trust_env=False) as client,
    ):
        response = client.post("/api/game/create", json={
            "player_name": "Harness human",
            "ai_opponents": [{"model_id": MODEL_ID, "name": "Scripted AI"}],
        })
        assert response.status_code == 200, response.text
        created = response.json()
        game_id = created["game_id"]
        human, opponent = created["players"]
        state_url = f"/api/game/{game_id}?player_id={human['id']}"
        assert client.get(state_url).json()["current_round"] is None
        with sqlite3.connect(backend.directory / "harness.sqlite3") as db:
            assert db.execute("SELECT count(*) FROM games").fetchone()[0] == 1
            assert db.execute("SELECT count(*) FROM players").fetchone()[0] == 2

        ws_url = f"{backend.url.replace('http:', 'ws:')}/ws/{game_id}?player_id={human['id']}"
        with connect(ws_url, proxy=None) as ws:
            assert receive_until(ws, "game_state")[-1]["data"]["current_round"] is None
            ws.send(json.dumps({"type": "start_round"}))
            opening = receive_until(ws, "turn_changed")
            assert [e["type"] for e in opening[:3]] == [
                "round_started", "game_state", "cards_dealt",
            ]
            assert opening[-1]["data"]["current_player_id"] == human["id"]
            assert "call" in opening[-1]["data"]["available_actions"]
            assert client.get(state_url).json()["players"][1]["hand"] is None

            ws.send(json.dumps({"type": "player_action", "data": {"action": "check_cards"}}))
            peek = receive_until(ws, "turn_changed")
            assert peek[0]["data"]["amount"] == 0
            visible = client.get(state_url).json()
            assert len(visible["players"][0]["hand"]) == 3
            assert visible["players"][1]["hand"] is None
            assert visible["players"][0]["chips"] == 990

            ws.send(json.dumps({"type": "player_action", "data": {"action": "call"}}))
            ending = receive_until(ws, "round_ended")
            settled = receive_until(ws, "game_state")[-1]["data"]
            assert ending[0]["data"]["amount"] == 20
            assert ending[-2]["type"] == "game_state"
            assert ending[-2]["data"] == settled
            assert ending[-1]["data"]["winner_id"] == human["id"]
            assert ending[-1]["data"]["pot"] == 50
            assert [p["chips"] for p in settled["players"]] == [1020, 980]
            assert settled["current_round"]["phase"] == "settlement"
            assert len(settled["round_history"]) == 1
            assert all(
                not e["data"]["is_fallback"] for e in opening + ending
                if e["type"] == "player_acted"
            )

        assert client.get(state_url).json() == settled
        thoughts = client.get(f"/api/game/{game_id}/thoughts/{opponent['id']}/round/1")
        assert thoughts.status_code == 200
        assert [t["decision"] for t in thoughts.json()["thoughts"]] == ["call", "fold"]
        deadline = time.monotonic() + 5
        while True:
            narrative = client.get(f"/api/game/{game_id}/narrative/{opponent['id']}/round/1")
            if narrative.status_code != 404 or time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        assert narrative.status_code == 200, narrative.text
        assert narrative.json()["outcome"] == "scripted"
        assert client.get(f"/api/game/{game_id}/summary/{opponent['id']}").status_code == 404

        with connect(ws_url, proxy=None) as ws:
            assert receive_until(ws, "game_state")[-1]["data"] == settled
            ws.send(json.dumps({"type": "start_round"}))
            next_hand = receive_until(ws, "turn_changed")
            assert next_hand[0]["data"]["round_number"] == 2
            assert next_hand[0]["data"]["dealer_index"] == 1
        diagnostics = client.get("/__harness__/diagnostics").json()
        assert diagnostics["provider_attempts"] == []
        assert diagnostics["blocked_network"] == []
        assert diagnostics["scripted_decisions"] == 2
        assert diagnostics["scripted_narratives"] == 1


def test_parallel_servers_own_database_ports_and_cleanup() -> None:
    """两个服务的注册表/DB/端口相互隔离，退出不留下监听器或临时目录。"""
    with running_backend() as first, running_backend() as second:
        assert first.url != second.url
        assert first.directory != second.directory
        with httpx.Client(trust_env=False) as client:
            created = client.post(f"{first.url}/api/game/create", json={
                "ai_opponents": [{"model_id": MODEL_ID}],
            }).json()
            assert client.get(f"{second.url}/api/game/{created['game_id']}").status_code == 404
        with sqlite3.connect(second.directory / "harness.sqlite3") as db:
            assert db.execute("SELECT count(*) FROM games").fetchone()[0] == 0
    for backend in (first, second):
        assert backend.process.poll() == 0
        assert not backend.directory.exists()
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex(("127.0.0.1", urlsplit(backend.url).port)) != 0


def test_occupied_port_fails_without_touching_its_owner() -> None:
    """指定端口已占用时拒绝启动；已有监听 socket 始终存活。"""
    with socket.socket() as owner:
        owner.bind(("127.0.0.1", 0))
        owner.listen()
        with pytest.raises(RuntimeError, match="Harness startup failed"):
            with running_backend(owner.getsockname()[1]):
                pytest.fail("An occupied port must never be reused")
        with socket.create_connection(owner.getsockname(), timeout=1):
            connection, _ = owner.accept()
            connection.close()


def test_child_environment_and_network_guards() -> None:
    """独立子进程验证环境清理及 socket 审计；不安装不可逆 hook 到 pytest 进程。"""
    script = """
import asyncio, os, socket, sys, tempfile
from pathlib import Path
from tests.harness.__main__ import blocked_network, deny_network, isolate_environment
from tests.harness.providers import install_provider_stub

original = Path.cwd()
with tempfile.TemporaryDirectory() as root:
    os.environ['OPENROUTER_API_KEY'] = 'synthetic-must-be-removed'
    os.environ['DATABASE_URL'] = 'synthetic-must-be-replaced'
    try:
        isolate_environment(Path(root))
        assert 'OPENROUTER_API_KEY' not in os.environ
        assert os.environ['DATABASE_URL'].endswith('/harness.sqlite3')
        assert Path.cwd() == Path(root).resolve()
        sys.addaudithook(deny_network)
        for operation in (
            lambda: socket.getaddrinfo('provider.invalid', 443),
            lambda: socket.socket().connect(('192.0.2.1', 443)),
        ):
            try:
                operation()
            except RuntimeError as error:
                assert 'Harness forbids outbound network' in str(error)
            else:
                raise AssertionError('Network guard did not reject the call')
        assert blocked_network == ['socket.getaddrinfo', 'socket.connect']
        attempts = []
        install_provider_stub(attempts)
        import litellm
        try:
            asyncio.run(litellm.acompletion(model='synthetic'))
        except AssertionError as error:
            assert 'Real providers are disabled' in str(error)
        else:
            raise AssertionError('Provider boundary did not reject the call')
        assert attempts == ['litellm.acompletion']
    finally:
        os.chdir(original)
"""
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=BACKEND, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="B01: advance_turn compares count % active_count >= active_count; never increments",
)
def test_b01_call_only_hand_reaches_turn_limit() -> None:
    """B01 最小复现；使用 --runxfail 可显示原始失败，不修改轮数或结算状态。"""
    game = create_game([
        {"name": "Human", "player_type": "human"},
        {"name": "Scripted caller", "player_type": "ai", "model_id": MODEL_ID},
    ], GameConfig(initial_chips=1000, ante=10, max_turns=3))
    round_state = start_round(game, Deck(seed=20260926))
    # 超过三轮仍有充足筹码；多给一整轮，排除边界检查前后的差异。
    for _ in range(2 * (game.config.max_turns + 1)):
        if round_state.phase != GamePhase.BETTING:
            break
        player = game.players[round_state.current_player_index]
        apply_action(game, player.id, GameAction.CALL)
    assert round_state.phase == GamePhase.SETTLEMENT, (
        f"After {len(round_state.actions)} legal calls: "
        f"phase={round_state.phase.value}, turn_count={round_state.turn_count}"
    )
