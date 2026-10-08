"""T4.3 测试: WebSocket + AI 回合调度

验证:
1. WebSocketManager 单元测试（连接管理、消息发送）
2. 事件构建函数测试
3. WebSocket 连接端点（连接、断开、错误处理）
4. 客户端事件处理（player_action, start_round, chat_message）
5. process_ai_turns() AI 回合调度
6. handle_player_chat() 玩家聊天处理
7. 完整人机对弈回合集成测试
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.agents.agent_manager import AgentManager, get_agent_manager
from app.agents.base_agent import BaseAgent, Decision, ThoughtData
from app.agents.chat_engine import ChatEngine
from app.api.game_store import get_game_store, reset_game_store
from app.api.websocket import (
    WebSocketManager,
    event_ai_reviewing,
    event_ai_thinking,
    event_cards_dealt,
    event_chat_message,
    event_error,
    event_game_ended,
    event_player_acted,
    event_round_ended,
    event_round_started,
    event_turn_changed,
    get_ws_manager,
    handle_player_chat,
    process_ai_turns,
    reset_ws_manager,
)
from app.db.database import get_db
from app.engine.game_manager import create_game, start_round
from app.main import create_app
from app.models.chat import ChatContext, ChatMessage, ChatMessageType
from app.models.game import (
    GameAction,
    GameConfig,
    GamePhase,
    GameState,
    Player,
    PlayerStatus,
)

# ---- Fixtures ----


@pytest.fixture
def ws_manager():
    """创建新的 WebSocketManager 实例"""
    return WebSocketManager()


@pytest.fixture
def game_state():
    """创建一个标准的测试游戏状态（1 人类 + 2 AI）"""
    player_configs = [
        {"name": "玩家", "player_type": "human", "avatar": "avatar_human"},
        {
            "name": "AI-张三",
            "player_type": "ai",
            "model_id": "copilot-gpt4o-mini",
        },
        {
            "name": "AI-李四",
            "player_type": "ai",
            "model_id": "copilot-gpt4o-mini",
        },
    ]
    config = GameConfig(initial_chips=1000, ante=10)
    return create_game(player_configs, config)


@pytest.fixture
def agent_manager(game_state):
    """创建 AgentManager 并为游戏注册 Agent"""
    mgr = AgentManager()
    ai_players = [p for p in game_state.players if p.is_ai]
    agent_configs = [
        {
            "agent_id": p.id,
            "name": p.name,
            "model_id": p.model_id or "copilot-gpt4o-mini",
        }
        for p in ai_players
    ]
    mgr.create_agents_for_game(game_state.game_id, agent_configs)
    return mgr


@pytest.fixture
def chat_engine():
    """创建 ChatEngine 实例"""
    return ChatEngine()


@pytest_asyncio.fixture
async def test_app(async_engine):
    """创建测试 FastAPI 应用"""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    test_session_factory = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def _override_get_db():
        async with test_session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    yield app
    reset_game_store()
    reset_ws_manager()
    app.dependency_overrides.clear()


# ========== 1. WebSocketManager 单元测试 ==========


class TestWebSocketManager:
    """WebSocketManager 单元测试"""

    def test_initial_state(self, ws_manager):
        """初始状态应无连接"""
        assert ws_manager.active_game_count == 0
        assert ws_manager.get_connections("game-1") == {}

    @pytest.mark.asyncio
    async def test_connect_and_disconnect(self, ws_manager):
        """测试连接和断开"""
        mock_ws = AsyncMock()
        await ws_manager.connect("game-1", "player-1", mock_ws)

        mock_ws.accept.assert_awaited_once()
        assert ws_manager.active_game_count == 1
        conns = ws_manager.get_connections("game-1")
        assert "player-1" in conns
        assert conns["player-1"] is mock_ws

        ws_manager.disconnect("game-1", "player-1", mock_ws)
        assert ws_manager.active_game_count == 0
        assert ws_manager.get_connections("game-1") == {}

    @pytest.mark.asyncio
    async def test_multiple_connections(self, ws_manager):
        """测试多个连接"""
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await ws_manager.connect("game-1", "p1", ws1)
        await ws_manager.connect("game-1", "p2", ws2)

        conns = ws_manager.get_connections("game-1")
        assert len(conns) == 2

        ws_manager.disconnect("game-1", "p1", ws1)
        assert len(ws_manager.get_connections("game-1")) == 1

    @pytest.mark.asyncio
    async def test_send_to_player(self, ws_manager):
        """测试发送消息给单个玩家"""
        mock_ws = AsyncMock()
        await ws_manager.connect("game-1", "p1", mock_ws)

        event = {"type": "test", "data": "hello"}
        await ws_manager.send_to_player("game-1", "p1", event)

        mock_ws.send_json.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_send_to_nonexistent_player(self, ws_manager):
        """向不存在的玩家发送不报错"""
        await ws_manager.send_to_player("game-1", "no-one", {"type": "test"})
        # 不抛异常即可

    @pytest.mark.asyncio
    async def test_broadcast(self, ws_manager):
        """测试广播消息"""
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        ws3 = AsyncMock()
        await ws_manager.connect("game-1", "p1", ws1)
        await ws_manager.connect("game-1", "p2", ws2)
        await ws_manager.connect("game-1", "p3", ws3)

        event = {"type": "test"}
        await ws_manager.broadcast("game-1", event)

        ws1.send_json.assert_awaited_once_with(event)
        ws2.send_json.assert_awaited_once_with(event)
        ws3.send_json.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_broadcast_with_exclude(self, ws_manager):
        """测试广播排除某个玩家"""
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await ws_manager.connect("game-1", "p1", ws1)
        await ws_manager.connect("game-1", "p2", ws2)

        event = {"type": "test"}
        await ws_manager.broadcast("game-1", event, exclude="p1")

        ws1.send_json.assert_not_awaited()
        ws2.send_json.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_broadcast_handles_send_error(self, ws_manager):
        """广播时发送失败不影响其他玩家"""
        ws1 = AsyncMock()
        ws1.send_json.side_effect = Exception("connection closed")
        ws2 = AsyncMock()
        await ws_manager.connect("game-1", "p1", ws1)
        await ws_manager.connect("game-1", "p2", ws2)

        event = {"type": "test"}
        await ws_manager.broadcast("game-1", event)

        # ws2 仍然收到了消息
        ws2.send_json.assert_awaited_once_with(event)

    def test_chat_context(self, ws_manager):
        """测试聊天上下文管理"""
        ctx = ws_manager.get_chat_context("game-1")
        assert isinstance(ctx, ChatContext)
        assert len(ctx.messages) == 0

        # 同一游戏获取同一上下文
        ctx2 = ws_manager.get_chat_context("game-1")
        assert ctx is ctx2

        # 不同游戏获取不同上下文
        ctx3 = ws_manager.get_chat_context("game-2")
        assert ctx3 is not ctx

    def test_remove_game(self, ws_manager):
        """测试清除游戏"""
        ws_manager._connections["game-1"] = {"p1": MagicMock()}
        ws_manager._chat_contexts["game-1"] = ChatContext()

        ws_manager.remove_game("game-1")
        assert "game-1" not in ws_manager._connections
        assert "game-1" not in ws_manager._chat_contexts

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent(self, ws_manager):
        """断开不存在的连接不报错"""
        ws_manager.disconnect("no-game", "no-player", AsyncMock())
        # 不抛异常即可


# ========== 2. 事件构建函数测试 ==========


class TestEventBuilders:
    """事件构建函数测试"""

    def test_event_round_started(self):
        e = event_round_started(1, "庄家")
        assert e["type"] == "round_started"
        assert e["data"]["round_number"] == 1
        assert e["data"]["dealer"] == "庄家"

    def test_event_cards_dealt(self):
        cards = [{"suit": "hearts", "rank": "K"}]
        e = event_cards_dealt(cards)
        assert e["type"] == "cards_dealt"
        assert e["data"]["your_cards"] == cards

    def test_event_turn_changed(self):
        e = event_turn_changed("张三", "p-1", ["call", "fold"])
        assert e["type"] == "turn_changed"
        assert e["data"]["current_player"] == "张三"
        assert e["data"]["current_player_id"] == "p-1"
        assert "call" in e["data"]["available_actions"]

    def test_event_player_acted(self):
        e = event_player_acted("p-1", "张三", "call", amount=10)
        assert e["type"] == "player_acted"
        assert e["data"]["player_id"] == "p-1"
        assert e["data"]["action"] == "call"
        assert e["data"]["amount"] == 10

    def test_event_player_acted_with_compare(self):
        cr = {"winner_id": "p-1", "loser_id": "p-2"}
        e = event_player_acted("p-1", "张三", "compare", compare_result=cr)
        assert e["data"]["compare_result"] == cr

    def test_event_chat_message(self):
        msg = ChatMessage(
            player_id="p-1",
            player_name="张三",
            message_type=ChatMessageType.ACTION_TALK,
            content="来吧！",
        )
        e = event_chat_message(msg)
        assert e["type"] == "chat_message"
        assert e["data"]["content"] == "来吧！"
        assert e["data"]["message_type"] == "action_talk"

    def test_event_round_ended(self):
        result = {"winner_id": "p-1", "pot": 100}
        e = event_round_ended(result)
        assert e["type"] == "round_ended"
        assert e["data"]["pot"] == 100

    def test_event_game_ended(self):
        result = {"final_standings": []}
        e = event_game_ended(result)
        assert e["type"] == "game_ended"

    def test_event_ai_thinking(self):
        e = event_ai_thinking("p-1", "AI-1")
        assert e["type"] == "ai_thinking"
        assert e["data"]["player_id"] == "p-1"

    def test_event_ai_reviewing(self):
        e = event_ai_reviewing("p-1", "AI-1", "连续失利")
        assert e["type"] == "ai_reviewing"
        assert e["data"]["trigger"] == "连续失利"

    def test_event_error(self):
        e = event_error("出错了")
        assert e["type"] == "error"
        assert e["data"]["message"] == "出错了"


# ========== 3. WebSocket 连接端点测试 ==========


class TestWebSocketEndpoint:
    """WebSocket 连接端点测试（使用 Starlette TestClient）"""

    def _create_game_in_store(self, app) -> GameState:
        """在 store 中创建一个测试游戏"""
        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs, GameConfig(initial_chips=1000, ante=10))
        store = get_game_store()
        store.put(game)

        # 同步注册 Agent
        mgr = get_agent_manager()
        ai_players = [p for p in game.players if p.is_ai]
        mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": p.id,
                    "name": p.name,
                    "model_id": "copilot-gpt4o-mini",
                }
                for p in ai_players
            ],
        )
        return game

    def test_connect_without_player_id(self, test_app):
        """缺少 player_id 应关闭连接"""
        client = TestClient(test_app)
        game = self._create_game_in_store(test_app)

        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect(f"/ws/{game.game_id}") as ws:
                ws.receive_json()
        assert closed.value.code == 4001
        reset_game_store()
        reset_ws_manager()

    def test_connect_to_nonexistent_game(self, test_app):
        """连接不存在的游戏应关闭连接"""
        client = TestClient(test_app)

        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("/ws/no-such-game?player_id=p1") as ws:
                ws.receive_json()
        assert closed.value.code == 4004
        reset_game_store()
        reset_ws_manager()

    def test_connect_with_invalid_player(self, test_app):
        """不属于游戏的玩家应关闭连接"""
        client = TestClient(test_app)
        game = self._create_game_in_store(test_app)

        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect(
                f"/ws/{game.game_id}?player_id=invalid-player"
            ) as ws:
                ws.receive_json()
        assert closed.value.code == 4003
        reset_game_store()
        reset_ws_manager()

    def test_connect_success_receives_game_state(self, test_app):
        """成功连接后应收到初始游戏状态"""
        client = TestClient(test_app)
        game = self._create_game_in_store(test_app)
        human = next(p for p in game.players if not p.is_ai)

        with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
            data = ws.receive_json()
            assert data["type"] == "game_state"
            assert data["data"]["game_id"] == game.game_id

        reset_game_store()
        reset_ws_manager()

    def test_unknown_event_type(self, test_app):
        """发送未知事件类型应收到错误"""
        client = TestClient(test_app)
        game = self._create_game_in_store(test_app)
        human = next(p for p in game.players if not p.is_ai)

        with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
            # 消费初始 game_state
            ws.receive_json()

            ws.send_json({"type": "invalid_event"})
            response = ws.receive_json()
            assert response["type"] == "error"
            assert "Unknown event type" in response["data"]["message"]

        reset_game_store()
        reset_ws_manager()


# ========== 4. 客户端事件处理测试 ==========


class TestStartRound:
    """start_round 事件处理测试"""

    def test_start_round_via_ws(self, test_app):
        """通过 WebSocket 开始新局"""
        client = TestClient(test_app)

        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs, GameConfig(initial_chips=1000, ante=10))
        store = get_game_store()
        store.put(game)

        # 注册 Agent（mock make_decision）
        mgr = get_agent_manager()
        ai_player = next(p for p in game.players if p.is_ai)
        agents = mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": ai_player.id,
                    "name": ai_player.name,
                    "model_id": "copilot-gpt4o-mini",
                }
            ],
        )

        human = next(p for p in game.players if not p.is_ai)

        # Mock AI decision to prevent actual LLM calls
        mock_decision = Decision(
            action=GameAction.CALL,
            table_talk=None,
            thought=ThoughtData(reasoning="test"),
        )

        with patch.object(
            BaseAgent, "make_decision", new_callable=AsyncMock, return_value=mock_decision
        ):
            with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
                # 消费初始 game_state
                ws.receive_json()

                # 发送 start_round
                ws.send_json({"type": "start_round"})

                # 收集所有事件（带超时）
                events = []
                import time

                deadline = time.time() + 3.0
                while time.time() < deadline:
                    try:
                        data = ws.receive_json()
                        events.append(data)
                        # 如果收到 turn_changed 事件（轮到人类），停止
                        if data["type"] == "turn_changed":
                            break
                        # 如果收到 round_ended，也停止
                        if data["type"] == "round_ended":
                            break
                    except Exception:
                        break

                event_types = [e["type"] for e in events]

                # 应该有 round_started 事件
                assert "round_started" in event_types

                # 应该有 cards_dealt 事件
                assert "cards_dealt" in event_types

        reset_game_store()
        reset_ws_manager()

    def test_start_round_game_finished(self, test_app):
        """游戏已结束时开始新局应报错"""
        client = TestClient(test_app)

        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {"name": "AI-1", "player_type": "ai", "model_id": "copilot-gpt4o-mini"},
        ]
        game = create_game(player_configs)
        game.status = "finished"
        store = get_game_store()
        store.put(game)

        human = next(p for p in game.players if not p.is_ai)

        with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
            ws.receive_json()  # game_state
            ws.send_json({"type": "start_round"})
            data = ws.receive_json()
            assert data["type"] == "error"

        reset_game_store()
        reset_ws_manager()


class TestPlayerAction:
    """player_action 事件处理测试"""

    def _setup_game_with_round(self) -> tuple[GameState, Player, Player]:
        """创建并开始一局游戏，返回 (game, human, ai)"""
        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs, GameConfig(initial_chips=1000, ante=10))
        start_round(game)

        human = next(p for p in game.players if not p.is_ai)
        ai = next(p for p in game.players if p.is_ai)

        store = get_game_store()
        store.put(game)

        mgr = get_agent_manager()
        mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": ai.id,
                    "name": ai.name,
                    "model_id": "copilot-gpt4o-mini",
                }
            ],
        )

        return game, human, ai

    def test_player_fold(self, test_app):
        """玩家弃牌"""
        client = TestClient(test_app)
        game, human, ai = self._setup_game_with_round()

        # 确保轮到人类玩家
        round_state = game.current_round
        assert round_state is not None
        current = game.players[round_state.current_player_index]

        # 如果不是人类先行动，先让 AI 行动
        if current.is_ai:
            from app.engine.game_manager import apply_action

            apply_action(game, current.id, GameAction.CALL)
            current = game.players[round_state.current_player_index]

        assert current.id == human.id

        with patch.object(
            BaseAgent,
            "make_decision",
            new_callable=AsyncMock,
            return_value=Decision(action=GameAction.CALL),
        ):
            with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
                ws.receive_json()  # game_state

                # 可能收到 turn_changed
                # 发送弃牌
                ws.send_json(
                    {
                        "type": "player_action",
                        "data": {"action": "fold"},
                    }
                )

                # 应该收到 player_acted 和 round_ended
                events = []
                import time

                deadline = time.time() + 3.0
                while time.time() < deadline:
                    try:
                        data = ws.receive_json()
                        events.append(data)
                        if data["type"] in ("round_ended", "error"):
                            break
                    except Exception:
                        break

                event_types = [e["type"] for e in events]
                assert "player_acted" in event_types

        reset_game_store()
        reset_ws_manager()

    def test_invalid_action(self, test_app):
        """发送无效操作应返回错误"""
        client = TestClient(test_app)
        game, human, ai = self._setup_game_with_round()

        # 确保轮到人类
        round_state = game.current_round
        assert round_state is not None
        current = game.players[round_state.current_player_index]
        if current.is_ai:
            from app.engine.game_manager import apply_action

            apply_action(game, current.id, GameAction.CALL)

        with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
            ws.receive_json()  # game_state

            ws.send_json(
                {
                    "type": "player_action",
                    "data": {"action": "invalid_action"},
                }
            )

            # 收集事件，可能先收到 turn_changed（连接时自动发送），再收到 error
            import time

            events = []
            deadline = time.time() + 3.0
            while time.time() < deadline:
                try:
                    data = ws.receive_json()
                    events.append(data)
                    if data["type"] == "error":
                        break
                except Exception:
                    break

            event_types = [e["type"] for e in events]
            assert "error" in event_types

        reset_game_store()
        reset_ws_manager()

    def test_not_your_turn(self, test_app):
        """非当前行动者操作应返回错误"""
        client = TestClient(test_app)
        game, human, ai = self._setup_game_with_round()

        # 确保轮到 AI
        round_state = game.current_round
        assert round_state is not None
        current = game.players[round_state.current_player_index]
        if current.id == human.id:
            from app.engine.game_manager import apply_action

            apply_action(game, human.id, GameAction.CALL)

        with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
            ws.receive_json()  # game_state

            ws.send_json(
                {
                    "type": "player_action",
                    "data": {"action": "call"},
                }
            )

            # 收集事件
            events = []
            import time

            deadline = time.time() + 2.0
            while time.time() < deadline:
                try:
                    data = ws.receive_json()
                    events.append(data)
                    if data["type"] == "error":
                        break
                except Exception:
                    break

            error_events = [e for e in events if e["type"] == "error"]
            assert len(error_events) > 0

        reset_game_store()
        reset_ws_manager()


class TestChatMessage:
    """chat_message 事件处理测试"""

    def test_chat_message_broadcast(self, test_app):
        """发送聊天消息应广播给所有玩家"""
        client = TestClient(test_app)

        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs)
        store = get_game_store()
        store.put(game)

        mgr = get_agent_manager()
        ai_player = next(p for p in game.players if p.is_ai)
        mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": ai_player.id,
                    "name": ai_player.name,
                    "model_id": "copilot-gpt4o-mini",
                }
            ],
        )

        human = next(p for p in game.players if not p.is_ai)

        # Mock bystander reactions to avoid LLM calls
        with patch.object(
            ChatEngine,
            "collect_bystander_reactions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
                ws.receive_json()  # game_state

                ws.send_json(
                    {
                        "type": "chat_message",
                        "data": {"content": "大家好！"},
                    }
                )

                import time

                deadline = time.time() + 2.0
                events = []
                while time.time() < deadline:
                    try:
                        data = ws.receive_json()
                        events.append(data)
                        if data["type"] == "chat_message":
                            break
                    except Exception:
                        break

                chat_events = [e for e in events if e["type"] == "chat_message"]
                assert len(chat_events) >= 1
                assert chat_events[0]["data"]["content"] == "大家好！"

        reset_game_store()
        reset_ws_manager()


# ========== 5. process_ai_turns 测试 ==========


class TestProcessAiTurns:
    """process_ai_turns 单元测试"""

    @pytest.mark.asyncio
    async def test_stops_at_human_player(self, game_state, agent_manager, chat_engine):
        """AI 回合处理应在轮到人类玩家时停止"""
        ws_mgr = WebSocketManager()
        game = game_state
        start_round(game)

        # 找到人类玩家
        human = next(p for p in game.players if not p.is_ai)

        # 确保当前行动者是 AI（如果不是，手动调整）
        round_state = game.current_round
        assert round_state is not None

        current = game.players[round_state.current_player_index]
        if not current.is_ai:
            # 已经轮到人类，直接测试
            await process_ai_turns(game.game_id, game, ws_mgr, agent_manager, chat_engine)
            # 确认游戏仍在进行
            assert game.current_round is not None
            assert game.current_round.phase == GamePhase.BETTING
            return

        # Mock AI decision
        mock_decision = Decision(
            action=GameAction.CALL,
            thought=ThoughtData(reasoning="test"),
        )
        with patch.object(
            BaseAgent,
            "make_decision",
            new_callable=AsyncMock,
            return_value=mock_decision,
        ):
            await process_ai_turns(game.game_id, game, ws_mgr, agent_manager, chat_engine)

        # 确认现在轮到人类玩家
        round_state = game.current_round
        if round_state and round_state.phase == GamePhase.BETTING:
            current = game.players[round_state.current_player_index]
            assert not current.is_ai

    @pytest.mark.asyncio
    async def test_handles_no_agent(self, game_state, chat_engine):
        """缺少 Agent 时应自动弃牌"""
        ws_mgr = WebSocketManager()
        game = game_state
        start_round(game)

        # 空的 agent_manager —— 没有注册任何 agent
        empty_mgr = AgentManager()

        round_state = game.current_round
        assert round_state is not None

        current = game.players[round_state.current_player_index]
        if not current.is_ai:
            # 如果轮到人类，跳过
            return

        await process_ai_turns(game.game_id, game, ws_mgr, empty_mgr, chat_engine)

        # AI 应该被 auto-fold 了
        assert current.status == PlayerStatus.FOLDED

    @pytest.mark.asyncio
    async def test_returns_when_no_round(self, game_state, agent_manager, chat_engine):
        """没有进行中的局时应直接返回"""
        ws_mgr = WebSocketManager()
        game = game_state
        # 不开始局
        await process_ai_turns(game.game_id, game, ws_mgr, agent_manager, chat_engine)
        # 不应抛异常

    @pytest.mark.asyncio
    async def test_ai_decision_failure_falls_back_to_fold(
        self, game_state, agent_manager, chat_engine
    ):
        """AI 决策失败时应降级为弃牌"""
        ws_mgr = WebSocketManager()
        game = game_state
        start_round(game)

        round_state = game.current_round
        assert round_state is not None

        current = game.players[round_state.current_player_index]
        if not current.is_ai:
            return

        # Mock decision to raise exception
        with patch.object(
            BaseAgent,
            "make_decision",
            new_callable=AsyncMock,
            side_effect=Exception("LLM failed"),
        ):
            await process_ai_turns(game.game_id, game, ws_mgr, agent_manager, chat_engine)

        assert current.status == PlayerStatus.FOLDED


# ========== 6. handle_player_chat 测试 ==========


class TestHandlePlayerChat:
    """handle_player_chat 单元测试"""

    @pytest.mark.asyncio
    async def test_chat_adds_to_context(self, game_state):
        """玩家聊天消息应添加到上下文"""
        ws_mgr = WebSocketManager()
        agent_mgr = AgentManager()
        ce = ChatEngine()
        game = game_state
        human = next(p for p in game.players if not p.is_ai)

        with patch.object(
            ChatEngine,
            "collect_bystander_reactions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            await handle_player_chat(
                game_id=game.game_id,
                game=game,
                player_id=human.id,
                content="你好",
                ws_manager=ws_mgr,
                agent_manager=agent_mgr,
                chat_engine=ce,
            )

        ctx = ws_mgr.get_chat_context(game.game_id)
        assert len(ctx.messages) == 1
        assert ctx.messages[0].content == "你好"
        assert ctx.messages[0].message_type == ChatMessageType.PLAYER_MESSAGE

    @pytest.mark.asyncio
    async def test_chat_broadcasts_message(self, game_state):
        """聊天消息应广播"""
        ws_mgr = WebSocketManager()
        mock_ws = AsyncMock()
        game = game_state
        human = next(p for p in game.players if not p.is_ai)

        await ws_mgr.connect(game.game_id, human.id, mock_ws)

        with patch.object(
            ChatEngine,
            "collect_bystander_reactions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            await handle_player_chat(
                game_id=game.game_id,
                game=game,
                player_id=human.id,
                content="测试消息",
                ws_manager=ws_mgr,
                agent_manager=AgentManager(),
                chat_engine=ChatEngine(),
            )

        # 检查是否发送了 chat_message 事件
        calls = mock_ws.send_json.call_args_list
        chat_events = [c for c in calls if c[0][0].get("type") == "chat_message"]
        assert len(chat_events) >= 1

    @pytest.mark.asyncio
    async def test_chat_invalid_player(self, game_state):
        """无效玩家 ID 的聊天应被忽略"""
        ws_mgr = WebSocketManager()

        with patch.object(
            ChatEngine,
            "collect_bystander_reactions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            await handle_player_chat(
                game_id=game_state.game_id,
                game=game_state,
                player_id="invalid-id",
                content="hello",
                ws_manager=ws_mgr,
                agent_manager=AgentManager(),
                chat_engine=ChatEngine(),
            )

        # 不应添加消息到上下文
        ctx = ws_mgr.get_chat_context(game_state.game_id)
        assert len(ctx.messages) == 0


# ========== 7. 全局单例测试 ==========


class TestGlobalSingleton:
    """全局单例管理测试"""

    def test_get_ws_manager_singleton(self):
        """get_ws_manager 应返回同一实例"""
        reset_ws_manager()
        mgr1 = get_ws_manager()
        mgr2 = get_ws_manager()
        assert mgr1 is mgr2
        reset_ws_manager()

    def test_reset_ws_manager(self):
        """reset_ws_manager 应重置单例"""
        mgr1 = get_ws_manager()
        reset_ws_manager()
        mgr2 = get_ws_manager()
        assert mgr1 is not mgr2
        reset_ws_manager()


# ========== 8. 完整人机对弈回合集成测试 ==========


class TestFullRoundIntegration:
    """完整人机对弈回合集成测试"""

    def test_full_round_human_folds(self, test_app):
        """完整回合: 人类弃牌，AI 获胜"""
        client = TestClient(test_app)

        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs, GameConfig(initial_chips=1000, ante=10))
        store = get_game_store()
        store.put(game)

        ai_player = next(p for p in game.players if p.is_ai)
        mgr = get_agent_manager()
        mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": ai_player.id,
                    "name": ai_player.name,
                    "model_id": "copilot-gpt4o-mini",
                }
            ],
        )

        human = next(p for p in game.players if not p.is_ai)

        mock_decision = Decision(
            action=GameAction.CALL,
            table_talk="跟！",
            thought=ThoughtData(reasoning="test"),
        )

        with patch.object(
            BaseAgent,
            "make_decision",
            new_callable=AsyncMock,
            return_value=mock_decision,
        ):
            with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
                # 消费初始 game_state
                init_data = ws.receive_json()
                assert init_data["type"] == "game_state"

                # Step 1: 开始新局
                ws.send_json({"type": "start_round"})

                # 收集事件直到轮到人类或本局结束
                events = []
                import time

                deadline = time.time() + 5.0
                human_turn = False

                while time.time() < deadline:
                    try:
                        data = ws.receive_json()
                        events.append(data)
                        if data["type"] == "turn_changed":
                            human_turn = True
                            break
                        if data["type"] == "round_ended":
                            break
                    except Exception:
                        break

                event_types = [e["type"] for e in events]
                assert "round_started" in event_types
                assert "cards_dealt" in event_types

                if human_turn:
                    # Step 2: 人类弃牌
                    ws.send_json(
                        {
                            "type": "player_action",
                            "data": {"action": "fold"},
                        }
                    )

                    # 应该收到 player_acted 和 round_ended
                    end_events = []
                    deadline = time.time() + 3.0
                    while time.time() < deadline:
                        try:
                            data = ws.receive_json()
                            end_events.append(data)
                            if data["type"] == "round_ended":
                                break
                        except Exception:
                            break

                    end_types = [e["type"] for e in end_events]
                    assert "player_acted" in end_types
                    assert "round_ended" in end_types

                    # 验证 round_ended 数据
                    round_end = next(e for e in end_events if e["type"] == "round_ended")
                    assert round_end["data"]["winner_id"] == ai_player.id

        reset_game_store()
        reset_ws_manager()

    def test_full_round_ai_plays_after_human(self, test_app):
        """完整回合: 人类跟注后 AI 继续行动"""
        client = TestClient(test_app)

        player_configs = [
            {"name": "玩家", "player_type": "human"},
            {
                "name": "AI-1",
                "player_type": "ai",
                "model_id": "copilot-gpt4o-mini",
            },
        ]
        game = create_game(player_configs, GameConfig(initial_chips=1000, ante=10))
        store = get_game_store()
        store.put(game)

        ai_player = next(p for p in game.players if p.is_ai)
        mgr = get_agent_manager()
        mgr.create_agents_for_game(
            game.game_id,
            [
                {
                    "agent_id": ai_player.id,
                    "name": ai_player.name,
                    "model_id": "copilot-gpt4o-mini",
                }
            ],
        )

        human = next(p for p in game.players if not p.is_ai)

        # AI will call, then when human calls, AI will fold to end round
        call_count = 0

        async def mock_decide(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                return Decision(action=GameAction.CALL)
            else:
                return Decision(action=GameAction.FOLD)

        with patch.object(
            BaseAgent,
            "make_decision",
            side_effect=mock_decide,
        ):
            with client.websocket_connect(f"/ws/{game.game_id}?player_id={human.id}") as ws:
                ws.receive_json()  # game_state

                ws.send_json({"type": "start_round"})

                # 收集事件直到轮到人类
                events = []
                import time

                deadline = time.time() + 5.0

                while time.time() < deadline:
                    try:
                        data = ws.receive_json()
                        events.append(data)
                        if data["type"] == "turn_changed":
                            break
                        if data["type"] == "round_ended":
                            break
                    except Exception:
                        break

                # 如果轮到人类了，跟注
                last_event = events[-1] if events else {}
                if last_event.get("type") == "turn_changed":
                    ws.send_json(
                        {
                            "type": "player_action",
                            "data": {"action": "call"},
                        }
                    )

                    # 收集 AI 响应
                    deadline = time.time() + 5.0
                    while time.time() < deadline:
                        try:
                            data = ws.receive_json()
                            events.append(data)
                            if data["type"] in ("turn_changed", "round_ended"):
                                break
                        except Exception:
                            break

                # 验证 AI 确实行动了
                acted_events = [e for e in events if e["type"] == "player_acted"]
                assert len(acted_events) >= 1

        reset_game_store()
        reset_ws_manager()
