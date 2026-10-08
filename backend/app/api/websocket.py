"""WebSocket + AI 回合调度 (T4.3)

实现:
- WebSocketManager: 管理每场游戏的 WebSocket 连接
- 客户端事件处理: player_action, chat_message, start_round
- 服务端事件推送: 全部 11 种事件类型
- process_ai_turns(): AI 回合的完整调度循环
- handle_player_chat(): 玩家消息处理 + AI 回应调度

WebSocket 连接: ws://localhost:8000/ws/{game_id}?player_id={player_id}
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.agent_manager import AgentManager, get_agent_manager
from app.agents.base_agent import (
    BaseAgent,
    ThoughtData,
    format_hand_description,
    format_players_status,
)
from app.agents.base_agent import LLMCallError
from app.agents.chat_engine import (
    ChatEngine,
    TriggerEvent,
    TriggerEventType,
    create_player_message_event,
    create_trigger_event_from_action,
)
from app.api.game_store import GameStore, get_game_store
from app.api.persistence import (
    persist_chat_message,
    persist_game_summary,
    persist_round_narrative,
    persist_thought_record,
)
from app.db.database import get_db
from app.db.schemas import ExperienceReviewDB, PlayerDB, RoundDB, RoundNarrativeDB
from app.engine.game_manager import (
    ActionResult,
    GameError,
    InvalidActionError,
    apply_action,
    get_visible_state,
    start_round,
)
from app.models.chat import ChatContext, ChatMessage, ChatMessageType
from app.models.game import (
    GameAction,
    GamePhase,
    GameState,
    Player,
    PlayerStatus,
    PlayerType,
    RoundResult,
    RoundState,
)
from app.models.thought import ThoughtRecord
from app.thought.reporter import ThoughtReporter

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_db_session():
    """获取一个独立的数据库 session（用于 WebSocket 上下文中的持久化）

    WebSocket 端点无法使用 FastAPI 的 Depends(get_db)，
    因此需要手动创建和管理 session。

    Returns:
        AsyncSession: 异步数据库会话（调用方负责 commit/close）
    """
    from app.db.database import _get_session_factory

    factory = _get_session_factory()
    return factory()


# ---- WebSocket Connection Manager ----


class WebSocketManager:
    """管理每场游戏的 WebSocket 连接

    维护 game_id -> {player_id -> WebSocket} 的两级映射。
    支持向单个玩家或整场游戏的所有玩家广播消息。
    """

    def __init__(self) -> None:
        # game_id -> {player_id -> WebSocket}
        self._connections: dict[str, dict[str, WebSocket]] = {}
        # game_id -> ChatContext (per-game chat context)
        self._chat_contexts: dict[str, ChatContext] = {}
        # game_id -> list[asyncio.Task] (游戏总结生成任务，支持取消)
        self._summary_tasks: dict[str, list[asyncio.Task]] = {}

    async def connect(self, game_id: str, player_id: str, websocket: WebSocket) -> None:
        """接受 WebSocket 连接并注册"""
        await websocket.accept()
        if game_id not in self._connections:
            self._connections[game_id] = {}
        previous = self._connections[game_id].get(player_id)
        self._connections[game_id][player_id] = websocket
        if previous is not None and previous is not websocket:
            try:
                await previous.close(code=4001, reason="Connection replaced")
            except Exception:
                logger.debug("Replaced WebSocket already closed: game=%s, player=%s", game_id, player_id)
        logger.info("WebSocket connected: game=%s, player=%s", game_id, player_id)

    def disconnect(self, game_id: str, player_id: str, websocket: WebSocket) -> None:
        """仅清理当前连接，避免旧连接退出时删除重连后的新连接。"""
        connections = self._connections.get(game_id)
        if connections is None or connections.get(player_id) is not websocket:
            return
        del connections[player_id]
        if not connections:
            del self._connections[game_id]
        logger.info("WebSocket disconnected: game=%s, player=%s", game_id, player_id)

    def get_connections(self, game_id: str) -> dict[str, WebSocket]:
        """获取某场游戏的所有连接"""
        return self._connections.get(game_id, {})

    def get_chat_context(self, game_id: str) -> ChatContext:
        """获取某场游戏的聊天上下文"""
        if game_id not in self._chat_contexts:
            self._chat_contexts[game_id] = ChatContext()
        return self._chat_contexts[game_id]

    def add_summary_task(self, game_id: str, task: asyncio.Task) -> None:
        """注册一个游戏总结生成任务"""
        if game_id not in self._summary_tasks:
            self._summary_tasks[game_id] = []
        self._summary_tasks[game_id].append(task)

    def cancel_summary_tasks(self, game_id: str) -> int:
        """取消某场游戏的所有总结生成任务

        Returns:
            被取消的任务数量
        """
        tasks = self._summary_tasks.pop(game_id, [])
        cancelled = 0
        for task in tasks:
            if not task.done():
                task.cancel()
                cancelled += 1
        if cancelled > 0:
            logger.info("取消总结生成任务 — game=%s, cancelled=%d", game_id, cancelled)
        return cancelled

    def remove_game(self, game_id: str) -> None:
        """清除某场游戏的所有连接、聊天上下文和总结任务"""
        self._connections.pop(game_id, None)
        self._chat_contexts.pop(game_id, None)
        self.cancel_summary_tasks(game_id)

    async def send_to_player(self, game_id: str, player_id: str, event: dict[str, Any]) -> None:
        """向单个玩家发送事件"""
        connections = self._connections.get(game_id, {})
        ws = connections.get(player_id)
        if ws is not None:
            try:
                await ws.send_json(event)
            except Exception as e:
                logger.warning(
                    "Failed to send to player %s in game %s: %s",
                    player_id,
                    game_id,
                    e,
                )

    async def broadcast(
        self, game_id: str, event: dict[str, Any], exclude: str | None = None
    ) -> None:
        """向游戏中所有玩家广播事件

        Args:
            game_id: 游戏 ID
            event: 要发送的事件
            exclude: 要排除的玩家 ID（可选）
        """
        connections = self._connections.get(game_id, {})
        for player_id, ws in list(connections.items()):
            if exclude and player_id == exclude:
                continue
            try:
                await ws.send_json(event)
            except Exception as e:
                logger.warning(
                    "Failed to broadcast to player %s in game %s: %s",
                    player_id,
                    game_id,
                    e,
                )

    async def broadcast_game_state(self, game_id: str, game: GameState) -> None:
        """向每个连接的玩家发送各自视角的游戏状态"""
        connections = self._connections.get(game_id, {})
        for player_id in list(connections.keys()):
            visible = get_visible_state(game, player_id)
            await self.send_to_player(
                game_id,
                player_id,
                {
                    "type": "game_state",
                    "data": visible,
                },
            )

    @property
    def active_game_count(self) -> int:
        return len(self._connections)


# ---- Global Singleton ----

_ws_manager: WebSocketManager | None = None


def get_ws_manager() -> WebSocketManager:
    """获取全局 WebSocketManager 单例"""
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = WebSocketManager()
    return _ws_manager


def reset_ws_manager() -> None:
    """重置全局 WebSocketManager（仅用于测试）"""
    global _ws_manager
    _ws_manager = None


# ---- Server Event Builders ----


def event_game_started(game: GameState, viewer_id: str) -> dict[str, Any]:
    """game_started 事件"""
    return {
        "type": "game_started",
        "data": get_visible_state(game, viewer_id),
    }


def event_round_started(
    round_number: int,
    dealer_name: str,
    dealer_index: int = 0,
    pot: int = 0,
    current_bet: int = 0,
    max_turns: int = 10,
) -> dict[str, Any]:
    """round_started 事件"""
    return {
        "type": "round_started",
        "data": {
            "round_number": round_number,
            "dealer": dealer_name,
            "dealer_index": dealer_index,
            "pot": pot,
            "current_bet": current_bet,
            "max_turns": max_turns,
        },
    }


def event_cards_dealt(cards: list[dict] | None) -> dict[str, Any]:
    """cards_dealt 事件（发送给单个玩家的手牌）"""
    return {
        "type": "cards_dealt",
        "data": {"your_cards": cards},
    }


def event_turn_changed(
    current_player_name: str,
    current_player_id: str,
    available_actions: list[str],
) -> dict[str, Any]:
    """turn_changed 事件"""
    return {
        "type": "turn_changed",
        "data": {
            "current_player": current_player_name,
            "current_player_id": current_player_id,
            "available_actions": available_actions,
        },
    }


def event_player_acted(
    player_id: str,
    player_name: str,
    action: str,
    amount: int = 0,
    compare_result: dict | None = None,
    is_fallback: bool = False,
) -> dict[str, Any]:
    """player_acted 事件"""
    return {
        "type": "player_acted",
        "data": {
            "player_id": player_id,
            "player_name": player_name,
            "action": action,
            "amount": amount,
            "compare_result": compare_result,
            "is_fallback": is_fallback,
        },
    }


def event_chat_message(msg: ChatMessage) -> dict[str, Any]:
    """chat_message 事件"""
    return {
        "type": "chat_message",
        "data": {
            "id": msg.id,
            "player_id": msg.player_id,
            "player_name": msg.player_name,
            "message_type": msg.message_type.value,
            "content": msg.content,
            "timestamp": msg.timestamp,
        },
    }


def event_round_ended(round_result: dict) -> dict[str, Any]:
    """round_ended 事件"""
    return {
        "type": "round_ended",
        "data": round_result,
    }


def event_game_ended(game_result: dict) -> dict[str, Any]:
    """game_ended 事件"""
    return {
        "type": "game_ended",
        "data": game_result,
    }


def event_ai_thinking(player_id: str, player_name: str) -> dict[str, Any]:
    """ai_thinking 事件"""
    return {
        "type": "ai_thinking",
        "data": {"player_id": player_id, "player_name": player_name},
    }


def event_ai_reviewing(player_id: str, player_name: str, trigger: str) -> dict[str, Any]:
    """ai_reviewing 事件"""
    return {
        "type": "ai_reviewing",
        "data": {
            "player_id": player_id,
            "player_name": player_name,
            "trigger": trigger,
        },
    }


def event_error(message: str) -> dict[str, Any]:
    """error 事件"""
    return {
        "type": "error",
        "data": {"message": message},
    }


def event_copilot_error(
    message: str, error_code: str = "copilot_subscription_error"
) -> dict[str, Any]:
    """copilot_error 事件 — Copilot 订阅/授权错误

    前端收到此事件后应弹窗提示用户切换账号重新登录。
    """
    return {
        "type": "copilot_error",
        "data": {
            "message": message,
            "error_code": error_code,
        },
    }


# ---- AI Turn Processing ----


async def process_ai_turns(
    game_id: str,
    game: GameState,
    ws_manager: WebSocketManager,
    agent_manager: AgentManager,
    chat_engine: ChatEngine,
) -> None:
    """AI 回合的完整调度循环

    当轮到 AI 玩家行动时，自动处理：
    1. 经验回顾检查（如果有 ExperienceReviewer）
    2. AI 决策（make_decision）
    3. 执行操作（apply_action）
    4. 发言处理（table_talk）
    5. 旁观者反应收集
    6. 推送事件

    循环直到轮到人类玩家或本局结束。
    """
    round_state = game.current_round
    if round_state is None or round_state.phase != GamePhase.BETTING:
        return

    chat_context = ws_manager.get_chat_context(game_id)

    while True:
        round_state = game.current_round
        if round_state is None or round_state.phase != GamePhase.BETTING:
            break

        # 获取当前行动玩家
        current_player = game.players[round_state.current_player_index]

        # 如果是人类玩家，停止循环，等待 WebSocket 消息
        if current_player.player_type == PlayerType.HUMAN:
            # 通知人类玩家轮到他了
            from app.engine.rules import get_available_actions

            available = get_available_actions(
                round_state, current_player, game.players, game.config
            )
            await ws_manager.broadcast(
                game_id,
                event_turn_changed(
                    current_player.name,
                    current_player.id,
                    [a.value for a in available],
                ),
            )
            break

        # AI 玩家回合
        agent = agent_manager.get_agent(game_id, current_player.id)
        if agent is None:
            # Agent 不存在，降级为 fold
            logger.warning(
                "No agent found for AI player %s, auto-folding",
                current_player.name,
            )
            try:
                result = apply_action(game, current_player.id, GameAction.FOLD)
                await _broadcast_action_result(
                    game_id,
                    game,
                    current_player,
                    GameAction.FOLD,
                    result,
                    ws_manager,
                    is_fallback=True,
                )
                if result.round_ended:
                    await _handle_round_end(game_id, game, result, ws_manager, agent_manager)
                    break
            except GameError:
                break
            continue

        # Step 1: 广播 "AI 正在思考"
        await ws_manager.broadcast(
            game_id,
            event_ai_thinking(current_player.id, current_player.name),
        )

        # Step 2: 经验回顾检查（T3.1 — 如果模块可用）
        await _maybe_experience_review(game_id, game, agent, current_player, ws_manager)

        # Step 3: AI 决策
        chat_msgs_for_prompt = _format_chat_for_agent(chat_context)
        try:
            decision = await agent.make_decision(game, current_player, chat_msgs_for_prompt)
        except LLMCallError as e:
            if e.error_code == "copilot_subscription_error":
                # Copilot 订阅错误 — 广播特殊事件通知前端弹窗
                logger.error(
                    "Copilot subscription error for %s: %s",
                    current_player.name,
                    e,
                )
                await ws_manager.broadcast(
                    game_id,
                    event_copilot_error(str(e), e.error_code),
                )
            else:
                logger.error(
                    "AI decision failed for %s: %s, auto-folding",
                    current_player.name,
                    e,
                )
            decision = None
        except Exception as e:
            logger.error(
                "AI decision failed for %s: %s, auto-folding",
                current_player.name,
                e,
            )
            decision = None

        if decision is None:
            action = GameAction.FOLD
            target_id = None
            table_talk = None
            logger.info(
                "AI 决策降级 — game=%s, player=%s -> 自动弃牌",
                game_id,
                current_player.name,
            )
        else:
            action = decision.action
            target_id = decision.target
            table_talk = decision.table_talk
            logger.info(
                "AI 决策完成 — game=%s, player=%s, action=%s, confidence=%.2f",
                game_id,
                current_player.name,
                action.value,
                decision.thought.confidence if decision.thought else 0.0,
            )

        # Step 4: 执行操作
        try:
            result = apply_action(game, current_player.id, action, target_id)
        except GameError as e:
            logger.error(
                "AI action failed for %s (%s): %s, trying fold",
                current_player.name,
                action.value,
                e,
            )
            try:
                result = apply_action(game, current_player.id, GameAction.FOLD)
                action = GameAction.FOLD
            except GameError:
                logger.error("Even fold failed for %s, breaking", current_player.name)
                break

        # Step 5: 持久化思考记录（T4.4）
        if decision is not None and decision.thought is not None:
            thought_record = ThoughtRecord(
                agent_id=current_player.id,
                round_number=round_state.round_number if round_state else 0,
                turn_number=len(round_state.actions) if round_state else 0,
                hand_evaluation=decision.thought.hand_evaluation,
                opponent_analysis=decision.thought.opponent_analysis,
                risk_assessment=decision.thought.risk_assessment,
                chat_analysis=decision.thought.chat_analysis or None,
                reasoning=decision.thought.reasoning,
                confidence=decision.thought.confidence,
                emotion=decision.thought.emotion,
                decision=action,
                decision_target=target_id,
                table_talk=table_talk,
                raw_response=decision.raw_response,
            )
            try:
                db = await _get_db_session()
                try:
                    await persist_thought_record(db, game_id, thought_record)
                    await db.commit()
                finally:
                    await db.close()
            except Exception as e:
                logger.warning("Failed to persist thought record: %s", e)

        # Step 6: 广播操作结果
        is_fallback = decision.is_fallback if decision is not None else True
        await _broadcast_action_result(
            game_id, game, current_player, action, result, ws_manager, is_fallback
        )

        # Step 7: 处理行动发言（table_talk）
        if table_talk:
            talk_msg = ChatMessage(
                game_id=game_id,
                round_number=round_state.round_number if round_state else 0,
                player_id=current_player.id,
                player_name=current_player.name,
                message_type=ChatMessageType.ACTION_TALK,
                content=table_talk,
            )
            chat_context.add_message(talk_msg)
            await ws_manager.broadcast(game_id, event_chat_message(talk_msg))
            # 持久化聊天消息（T4.4）
            try:
                db = await _get_db_session()
                try:
                    await persist_chat_message(db, talk_msg)
                    await db.commit()
                finally:
                    await db.close()
            except Exception as e:
                logger.warning("Failed to persist chat message: %s", e)

        # Step 8: 检查是否本局结束（在旁观反应之前检查，避免对已结束的局收集反应）
        if result.round_ended:
            await _handle_round_end(game_id, game, result, ws_manager, agent_manager)
            break

        # Step 9: 如果下一个行动者是人类玩家，先发送 turn_changed 让玩家可以立即操作，
        # 再异步收集旁观者反应（旁观者聊天不影响游戏状态）
        next_round_state = game.current_round
        next_player = (
            game.players[next_round_state.current_player_index]
            if next_round_state and next_round_state.phase == GamePhase.BETTING
            else None
        )
        human_turn_notified = False
        if next_player and next_player.player_type == PlayerType.HUMAN:
            from app.engine.rules import get_available_actions

            available = get_available_actions(
                next_round_state, next_player, game.players, game.config
            )
            await ws_manager.broadcast(
                game_id,
                event_turn_changed(
                    next_player.name,
                    next_player.id,
                    [a.value for a in available],
                ),
            )
            human_turn_notified = True

        # Step 10: 旁观者反应（后台异步执行，不阻塞游戏循环）
        asyncio.create_task(
            _collect_and_broadcast_bystander_reactions(
                game_id=game_id,
                game=game,
                actor=current_player,
                action=action,
                result=result,
                agent_manager=agent_manager,
                chat_engine=chat_engine,
                chat_context=chat_context,
                ws_manager=ws_manager,
            )
        )

        # 如果已经提前通知了人类玩家，跳出循环（不再重复发送 turn_changed）
        if human_turn_notified:
            break

        # 小延迟让前端动画有时间播放
        await asyncio.sleep(0.5)


async def handle_player_chat(
    game_id: str,
    game: GameState,
    player_id: str,
    content: str,
    ws_manager: WebSocketManager,
    agent_manager: AgentManager,
    chat_engine: ChatEngine,
) -> None:
    """处理人类玩家发送的聊天消息

    流程：
    1. 创建 ChatMessage 并立即广播（同步，不阻塞）
    2. 将 AI 回复生成放入后台任务（不阻塞 WebSocket 消息循环）
    """
    player = game.get_player_by_id(player_id)
    if player is None:
        return

    round_number = 0
    if game.current_round:
        round_number = game.current_round.round_number

    # 创建并广播玩家消息（立即完成）
    player_msg = ChatMessage(
        game_id=game_id,
        round_number=round_number,
        player_id=player_id,
        player_name=player.name,
        message_type=ChatMessageType.PLAYER_MESSAGE,
        content=content,
    )
    logger.info(
        "玩家聊天 — game=%s, player=%s: %s",
        game_id,
        player.name,
        content[:100],
    )
    chat_context = ws_manager.get_chat_context(game_id)
    chat_context.add_message(player_msg)
    await ws_manager.broadcast(game_id, event_chat_message(player_msg))

    # 持久化玩家聊天消息（T4.4）
    try:
        db = await _get_db_session()
        try:
            await persist_chat_message(db, player_msg)
            await db.commit()
        finally:
            await db.close()
    except Exception as e:
        logger.warning("Failed to persist player chat message: %s", e)

    # 将 AI 回复生成放入后台任务，不阻塞 WebSocket 消息循环
    asyncio.create_task(
        _generate_ai_chat_responses(
            game_id=game_id,
            game=game,
            player_id=player_id,
            player_name=player.name,
            content=content,
            round_number=round_number,
            ws_manager=ws_manager,
            agent_manager=agent_manager,
            chat_engine=chat_engine,
            chat_context=chat_context,
        )
    )


async def _generate_ai_chat_responses(
    game_id: str,
    game: GameState,
    player_id: str,
    player_name: str,
    content: str,
    round_number: int,
    ws_manager: WebSocketManager,
    agent_manager: AgentManager,
    chat_engine: ChatEngine,
    chat_context: ChatContext,
) -> None:
    """后台任务：生成 AI 聊天回复并广播

    从 handle_player_chat 中拆出的耗时操作，通过 asyncio.create_task 异步执行，
    避免阻塞 WebSocket 消息循环。
    """
    try:
        # 创建触发事件并收集 AI 反应
        trigger = create_player_message_event(player_id, player_name, content)

        # 获取所有活跃的 AI Agent 作为旁观者（排除已弃牌的）
        all_agents = agent_manager.get_agents_for_game(game_id)
        bystanders = []
        for a in all_agents:
            p = game.get_player_by_id(a.agent_id)
            if p is not None and p.is_active:
                bystanders.append(a)
        if not bystanders:
            return

        # 构建各 Agent 的状态信息
        agent_states = _build_agent_states(game, bystanders)

        reactions = await chat_engine.collect_bystander_reactions(
            event=trigger,
            bystanders=bystanders,
            chat_context=chat_context,
            agent_states=agent_states,
        )

        # 广播 AI 回应
        for reaction in reactions:
            msg = reaction.to_chat_message(game_id=game_id, round_number=round_number)
            if msg is not None:
                chat_context.add_message(msg)
                await ws_manager.broadcast(game_id, event_chat_message(msg))
                # 持久化 AI 回应消息（T4.4）
                try:
                    db = await _get_db_session()
                    try:
                        await persist_chat_message(db, msg)
                        await db.commit()
                    finally:
                        await db.close()
                except Exception as e:
                    logger.warning("Failed to persist AI response chat message: %s", e)
                await asyncio.sleep(0.3)  # 间隔一小段时间，模拟打字
    except Exception as e:
        logger.error("后台 AI 聊天回复生成失败 — game=%s, error=%s", game_id, e)


# ---- Internal Helpers ----


async def _broadcast_action_result(
    game_id: str,
    game: GameState,
    player: Player,
    action: GameAction,
    result: ActionResult,
    ws_manager: WebSocketManager,
    is_fallback: bool = False,
) -> None:
    """广播操作结果事件 + 更新后的游戏状态"""
    if action == GameAction.COMPARE and result.compare_result:
        # 比牌操作：只向比牌双方发送手牌数据，其他人收到脱敏版本
        cr = result.compare_result
        compare_player_ids = {cr.get("winner_id"), cr.get("loser_id")}

        # 脱敏版本：移除手牌数据和牌型信息
        _sensitive_keys = ("winner_cards", "loser_cards", "winner_hand", "loser_hand")
        sanitized_cr = {k: v for k, v in cr.items() if k not in _sensitive_keys}
        for k in _sensitive_keys:
            sanitized_cr[k] = None

        connections = ws_manager.get_connections(game_id)
        for pid in list(connections):
            if pid in compare_player_ids:
                # 比牌双方：发送完整数据
                event = event_player_acted(
                    player_id=player.id,
                    player_name=player.name,
                    action=action.value,
                    amount=result.amount,
                    compare_result=cr,
                    is_fallback=is_fallback,
                )
            else:
                # 其他玩家：发送脱敏数据（不含手牌）
                event = event_player_acted(
                    player_id=player.id,
                    player_name=player.name,
                    action=action.value,
                    amount=result.amount,
                    compare_result=sanitized_cr,
                    is_fallback=is_fallback,
                )
            await ws_manager.send_to_player(game_id, pid, event)
    else:
        # 非比牌操作：正常广播
        await ws_manager.broadcast(
            game_id,
            event_player_acted(
                player_id=player.id,
                player_name=player.name,
                action=action.value,
                amount=result.amount,
                compare_result=result.compare_result,
                is_fallback=is_fallback,
            ),
        )

    # 广播更新后的游戏状态（筹码、底池、玩家状态等）
    # broadcast_game_state 已经是按玩家视角过滤的，无需修改
    await ws_manager.broadcast_game_state(game_id, game)


async def _handle_round_end(
    game_id: str,
    game: GameState,
    result: ActionResult,
    ws_manager: WebSocketManager,
    agent_manager: AgentManager | None = None,
) -> None:
    """处理局结束事件"""
    if result.round_result is not None:
        rr = result.round_result
        logger.info(
            "局结束 — game=%s, 第%d局, 赢家=%s, 底池=%d, 方式=%s",
            game_id,
            rr.round_number,
            rr.winner_name,
            rr.pot,
            rr.win_method,
        )
        round_result_dict = rr.model_dump(mode="json")
        await ws_manager.broadcast(game_id, event_round_ended(round_result_dict))

    # 广播更新后的游戏状态（含结算后的筹码）
    await ws_manager.broadcast_game_state(game_id, game)

    # 检查游戏是否整体结束
    if game.status == "finished":
        final_standings = [
            {"id": p.id, "name": p.name, "chips": p.chips}
            for p in sorted(game.players, key=lambda p: p.chips, reverse=True)
        ]
        logger.info(
            "游戏结束 — game=%s, 排名: %s",
            game_id,
            [(s["name"], s["chips"]) for s in final_standings],
        )
        await ws_manager.broadcast(
            game_id,
            event_game_ended({"final_standings": final_standings}),
        )

    # 异步生成各 AI 玩家的局叙事（不阻塞游戏流程）
    if agent_manager is not None and result.round_result is not None:
        rr = result.round_result
        round_state = game.current_round
        for player in game.players:
            if player.player_type != PlayerType.HUMAN:
                agent = agent_manager.get_agent(game_id, player.id)
                if agent is not None:
                    asyncio.create_task(
                        _generate_and_persist_narrative(
                            game_id=game_id,
                            agent=agent,
                            player=player,
                            round_number=rr.round_number,
                            round_result=rr,
                            round_state=round_state,
                            chat_context=ws_manager.get_chat_context(game_id),
                        )
                    )

    # NOTE: 游戏总结报告功能暂时禁用（OpenRouter json_object 兼容性问题）
    # 局叙事（心路历程）功能保留，见上方 _generate_and_persist_narrative 调用
    # if game.status == "finished" and agent_manager is not None:
    #     for player in game.players:
    #         if player.player_type != PlayerType.HUMAN:
    #             agent = agent_manager.get_agent(game_id, player.id)
    #             if agent is not None:
    #                 task = asyncio.create_task(
    #                     _generate_and_persist_game_summary(
    #                         game_id=game_id,
    #                         game=game,
    #                         agent=agent,
    #                         player=player,
    #                     )
    #                 )
    #                 ws_manager.add_summary_task(game_id, task)


async def _generate_and_persist_narrative(
    game_id: str,
    agent: BaseAgent,
    player: Player,
    round_number: int,
    round_result: RoundResult,
    round_state: RoundState | None,
    chat_context: ChatContext,
) -> None:
    """为指定 AI 玩家生成单局叙事并持久化（后台任务）

    从 Agent 内存中获取本局思考数据，调用 ThoughtReporter 生成叙事，
    然后写入数据库。此函数通过 asyncio.create_task 在后台执行，
    不阻塞游戏主流程。

    Args:
        game_id: 游戏 ID
        agent: AI Agent 实例
        player: 对应的玩家对象
        round_number: 局号
        round_result: 本局结算结果
        round_state: 结算时的局面状态（可能为 None）
        chat_context: 聊天上下文
    """
    try:
        reporter = ThoughtReporter(agent)

        # 从 Agent 内存中获取本局思考数据，转换为 ThoughtRecord
        thought_data_list = agent.get_round_thoughts(round_number)
        round_thoughts: list[ThoughtRecord] = []
        for i, td in enumerate(thought_data_list):
            round_thoughts.append(
                ThoughtRecord(
                    agent_id=player.id,
                    round_number=round_number,
                    turn_number=i + 1,
                    hand_evaluation=td.hand_evaluation,
                    opponent_analysis=td.opponent_analysis,
                    risk_assessment=td.risk_assessment,
                    chat_analysis=td.chat_analysis or None,
                    reasoning=td.reasoning,
                    confidence=td.confidence,
                    emotion=td.emotion,
                )
            )

        # 格式化聊天记录
        chat_msgs = chat_context.get_recent(20)
        chat_text = (
            "\n".join(f"{m.player_name}: {m.content}" for m in chat_msgs)
            if chat_msgs
            else "（本局无聊天记录）"
        )

        # 格式化行动历史
        if round_state and round_state.actions:
            action_lines: list[str] = []
            for a in round_state.actions:
                if a.amount:
                    action_lines.append(f"{a.player_name} {a.action.value}（{a.amount}筹码）")
                else:
                    action_lines.append(f"{a.player_name} {a.action.value}")
            action_history = "\n".join(action_lines)
        else:
            action_history = "（无行动记录）"

        # 手牌描述
        hand_description = format_hand_description(player.hand, True)

        # 本局结果描述
        if round_result.winner_id == player.id:
            round_outcome = f"赢得本局，获得 {round_result.pot} 筹码（{round_result.win_method}）"
        else:
            chip_change = round_result.player_chip_changes.get(player.id, 0)
            round_outcome = (
                f"本局失利，损失 {abs(chip_change)} 筹码"
                f"（赢家: {round_result.winner_name}，"
                f"{round_result.win_method}）"
            )

        # 调用 LLM 生成叙事
        narrative = await reporter.generate_round_narrative(
            round_number=round_number,
            round_thoughts=round_thoughts,
            chat_messages=chat_text,
            action_history=action_history,
            hand_description=hand_description,
            round_outcome=round_outcome,
        )

        # 持久化到数据库
        db = await _get_db_session()
        try:
            await persist_round_narrative(db, game_id, narrative)
            await db.commit()
            logger.info(
                "叙事生成成功 — game=%s, agent=%s, round=%d",
                game_id,
                player.name,
                round_number,
            )
        finally:
            await db.close()

    except Exception as e:
        logger.warning(
            "叙事生成失败 — game=%s, agent=%s, round=%d: %s",
            game_id,
            player.name,
            round_number,
            e,
        )


async def _generate_and_persist_game_summary(
    game_id: str,
    game: GameState,
    agent: BaseAgent,
    player: Player,
) -> None:
    """为指定 AI 玩家生成整场游戏总结并持久化（后台任务）

    从游戏历史和数据库中收集统计数据、叙事记录和经验回顾，
    调用 ThoughtReporter 生成游戏总结报告，然后写入数据库。
    此函数通过 asyncio.create_task 在后台执行，不阻塞游戏主流程。

    Args:
        game_id: 游戏 ID
        game: 完整游戏状态（含 round_history）
        agent: AI Agent 实例
        player: 对应的玩家对象
    """
    try:
        reporter = ThoughtReporter(agent)

        # 等待一段时间，让最后一局的叙事生成任务有机会完成
        # （叙事和总结都通过 asyncio.create_task 并发启动，
        #   总结需要从 DB 读取叙事，所以需要等叙事先写入）
        await asyncio.sleep(5)

        # 从 round_history 统计该玩家的游戏数据
        rounds_played = len(game.round_history)
        rounds_won = 0
        total_chips_won = 0
        total_chips_lost = 0
        biggest_win = 0
        biggest_loss = 0
        fold_count = 0

        for rr in game.round_history:
            chip_change = rr.player_chip_changes.get(player.id, 0)
            if rr.winner_id == player.id:
                rounds_won += 1
            if chip_change > 0:
                total_chips_won += chip_change
                biggest_win = max(biggest_win, chip_change)
            elif chip_change < 0:
                total_chips_lost += abs(chip_change)
                biggest_loss = max(biggest_loss, abs(chip_change))
                # 负筹码变化且不是赢家 → 可能弃牌或比牌失败
                # 简单估算弃牌：筹码损失较小的局（损失 < 底池的一半）
                if rr.winner_id != player.id and abs(chip_change) < rr.pot * 0.3:
                    fold_count += 1

        fold_rate = f"{fold_count / rounds_played * 100:.0f}%" if rounds_played > 0 else "0%"

        # 从数据库查询已持久化的叙事和经验回顾
        db = await _get_db_session()
        try:
            # 查询叙事记录
            narrative_stmt = (
                select(RoundNarrativeDB)
                .where(
                    RoundNarrativeDB.game_id == game_id,
                    RoundNarrativeDB.agent_id == player.id,
                )
                .order_by(RoundNarrativeDB.round_number)
            )
            narrative_result = await db.execute(narrative_stmt)
            narrative_records = narrative_result.scalars().all()
            all_narratives = (
                "\n".join(f"第{r.round_number}局: {r.narrative}" for r in narrative_records)
                if narrative_records
                else "（无叙事记录）"
            )

            # 查询经验回顾记录
            review_stmt = (
                select(ExperienceReviewDB)
                .where(
                    ExperienceReviewDB.game_id == game_id,
                    ExperienceReviewDB.agent_id == player.id,
                )
                .order_by(ExperienceReviewDB.triggered_at_round)
            )
            review_result = await db.execute(review_stmt)
            review_records = review_result.scalars().all()
            all_reviews = (
                "\n".join(
                    f"第{r.triggered_at_round}局回顾: {r.insight or ''}" for r in review_records
                )
                if review_records
                else "（无经验回顾）"
            )
        finally:
            await db.close()

        # 构建对手信息
        opponents_info_parts: list[str] = []
        for p in game.players:
            if p.id != player.id:
                opponents_info_parts.append(f"{p.name}: 最终筹码 {p.chips}")
        opponents_info = (
            "\n".join(opponents_info_parts) if opponents_info_parts else "（无对手信息）"
        )

        # 调用 LLM 生成游戏总结
        summary = await reporter.generate_game_summary(
            rounds_played=rounds_played,
            rounds_won=rounds_won,
            total_chips_won=total_chips_won,
            total_chips_lost=total_chips_lost,
            biggest_win=biggest_win,
            biggest_loss=biggest_loss,
            fold_rate=fold_rate,
            all_narratives=all_narratives,
            all_reviews=all_reviews,
            opponents_info=opponents_info,
        )

        # 持久化到数据库
        db = await _get_db_session()
        try:
            await persist_game_summary(db, game_id, summary)
            await db.commit()
            logger.info(
                "游戏总结生成成功 — game=%s, agent=%s",
                game_id,
                player.name,
            )
        finally:
            await db.close()

    except Exception as e:
        logger.warning(
            "游戏总结生成失败 — game=%s, agent=%s: %s",
            game_id,
            player.name,
            e,
        )


async def _maybe_experience_review(
    game_id: str,
    game: GameState,
    agent: BaseAgent,
    player: Player,
    ws_manager: WebSocketManager,
) -> None:
    """经验回顾检查（如果 T3.1 ExperienceReviewer 可用）

    目前 T3.1 尚未实现，此函数为占位。
    后续实现后会检查触发条件并执行回顾。
    """
    # TODO: T3.1 实现后补充
    # try:
    #     from app.agents.experience import ExperienceReviewer
    #     reviewer = ExperienceReviewer(agent)
    #     trigger = reviewer.check_trigger(game, ...)
    #     if trigger:
    #         await ws_manager.broadcast(
    #             game_id,
    #             event_ai_reviewing(player.id, player.name, trigger.reason),
    #         )
    #         review = await reviewer.perform_review(trigger, ...)
    #         agent.set_strategy_context(review.strategy_context)
    # except ImportError:
    #     pass
    pass


async def _collect_and_broadcast_bystander_reactions(
    game_id: str,
    game: GameState,
    actor: Player,
    action: GameAction,
    result: ActionResult,
    agent_manager: AgentManager,
    chat_engine: ChatEngine,
    chat_context: ChatContext,
    ws_manager: WebSocketManager,
) -> None:
    """收集并广播旁观者反应（可能作为后台任务运行）"""
    try:
        round_state = game.current_round
        current_bet = round_state.current_bet if round_state else 0

        # 构建触发事件
        compare_winner = None
        target_name = None
        if result.compare_result:
            compare_winner = result.compare_result.get("winner_id")
            target_name = result.compare_result.get("loser_name")
            if compare_winner == actor.id:
                target_name = result.compare_result.get("loser_name")
            else:
                target_name = result.compare_result.get("winner_name")

        trigger = create_trigger_event_from_action(
            action=action,
            actor_id=actor.id,
            actor_name=actor.name,
            amount=result.amount,
            current_bet=current_bet,
            target_name=target_name,
            compare_winner=compare_winner,
        )

        # 获取旁观者（排除行动者自己，排除已弃牌的玩家）
        all_agents = agent_manager.get_agents_for_game(game_id)
        bystanders = []
        for a in all_agents:
            if a.agent_id == actor.id:
                continue
            p = game.get_player_by_id(a.agent_id)
            if p is not None and p.is_active:
                bystanders.append(a)
        if not bystanders:
            return

        agent_states = _build_agent_states(game, bystanders)

        reactions = await chat_engine.collect_bystander_reactions(
            event=trigger,
            bystanders=bystanders,
            chat_context=chat_context,
            agent_states=agent_states,
        )

        for reaction in reactions:
            round_number = round_state.round_number if round_state else 0
            msg = reaction.to_chat_message(game_id=game_id, round_number=round_number)
            if msg is not None:
                chat_context.add_message(msg)
                await ws_manager.broadcast(game_id, event_chat_message(msg))
                # 持久化旁观者反应消息（T4.4）
                try:
                    db = await _get_db_session()
                    try:
                        await persist_chat_message(db, msg)
                        await db.commit()
                    finally:
                        await db.close()
                except Exception as e:
                    logger.warning("Failed to persist bystander reaction: %s", e)
                await asyncio.sleep(0.2)
    except Exception as e:
        logger.error("后台旁观者反应生成失败 — game=%s, error=%s", game_id, e)


def _format_chat_for_agent(chat_context: ChatContext) -> list[dict[str, str]]:
    """将 ChatContext 格式化为 agent.make_decision 需要的格式"""
    result: list[dict[str, str]] = []
    for msg in chat_context.get_recent(10):
        result.append({"sender": msg.player_name, "message": msg.content})
    return result


def _build_agent_states(
    game: GameState,
    agents: list[BaseAgent],
) -> dict[str, dict[str, Any]]:
    """构建各 Agent 的状态信息（用于旁观反应 prompt）

    包含手牌（已看牌时）、底池、注额、各玩家状态等完整局面信息，
    使 AI 在聊天时能基于实际局面做出合理回应。
    """
    states: dict[str, dict[str, Any]] = {}
    round_state = game.current_round
    for agent in agents:
        player = game.get_player_by_id(agent.agent_id)
        if player is None:
            continue
        seen_status = "已看牌" if player.has_seen_cards else "未看牌"
        state: dict[str, Any] = {
            "seen_status": seen_status,
            "chips": player.chips,
            "actions_summary": f"筹码 {player.chips}, 本局已下注 {player.total_bet_this_round}",
            # 手牌信息：已看牌时提供具体牌面和牌型，未看牌时为未知
            "hand_description": format_hand_description(player.hand, player.has_seen_cards),
        }
        # 局面信息：底池、注额、各玩家状态表
        if round_state:
            state["pot"] = round_state.pot
            state["current_bet"] = round_state.current_bet
            state["players_status"] = format_players_status(
                game.players, agent.agent_id, round_state
            )
        states[agent.agent_id] = state
    return states


# ---- WebSocket Endpoint ----


@router.websocket("/ws/{game_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    game_id: str,
    player_id: str | None = None,
) -> None:
    """WebSocket 连接端点

    连接方式: ws://localhost:8000/ws/{game_id}?player_id={player_id}

    客户端事件:
    - {"type": "player_action", "data": {"action": "...", "target": "..."}}
    - {"type": "chat_message", "data": {"content": "..."}}
    - {"type": "start_round"}

    服务端事件: 参见 event_* 函数
    """
    # 获取依赖
    ws_manager = get_ws_manager()
    store = get_game_store()
    agent_mgr = get_agent_manager()
    chat_engine = ChatEngine()

    # 验证 player_id
    if not player_id:
        # 尝试从 query params 获取
        player_id = websocket.query_params.get("player_id")

    if not player_id:
        await websocket.accept()
        await websocket.close(code=4001, reason="Missing player_id")
        return

    # 验证游戏存在
    game = store.get(game_id)
    if game is None:
        await websocket.accept()
        await websocket.close(code=4004, reason=f"Game {game_id} not found")
        return

    # 验证玩家属于该游戏
    player = game.get_player_by_id(player_id)
    if player is None:
        await websocket.accept()
        await websocket.close(code=4003, reason=f"Player {player_id} not in game {game_id}")
        return

    # 接受连接
    await ws_manager.connect(game_id, player_id, websocket)

    # 解析 provider_keys（从 query params 获取前端 localStorage 中的 API Keys）
    raw_provider_keys = websocket.query_params.get("provider_keys", "")
    api_keys: dict[str, str] = {}
    if raw_provider_keys:
        try:
            decoded = unquote(raw_provider_keys)
            parsed = json.loads(decoded)
            if isinstance(parsed, dict):
                api_keys = {k: v for k, v in parsed.items() if isinstance(v, str) and v.strip()}
        except (json.JSONDecodeError, TypeError):
            logger.warning("Failed to parse provider_keys query param for game=%s", game_id)

    # 将 API Keys 设置到该游戏的所有 Agent 上
    if api_keys:
        agent_mgr.set_api_keys_for_game(game_id, api_keys)

    try:
        # 发送当前游戏状态
        visible = get_visible_state(game, player_id)
        await ws_manager.send_to_player(
            game_id,
            player_id,
            {
                "type": "game_state",
                "data": visible,
            },
        )

        # 如果游戏正在进行且轮到人类玩家
        if game.current_round and game.current_round.phase == GamePhase.BETTING:
            current = game.players[game.current_round.current_player_index]
            if current.id == player_id:
                from app.engine.rules import get_available_actions

                available = get_available_actions(
                    game.current_round, current, game.players, game.config
                )
                await ws_manager.send_to_player(
                    game_id,
                    player_id,
                    event_turn_changed(current.name, current.id, [a.value for a in available]),
                )

        # 消息处理循环
        while True:
            data = await websocket.receive_json()
            if ws_manager.get_connections(game_id).get(player_id) is not websocket:
                break
            event_type = data.get("type", "")

            if event_type == "player_action":
                await _handle_player_action(
                    game_id=game_id,
                    player_id=player_id,
                    data=data.get("data", {}),
                    store=store,
                    ws_manager=ws_manager,
                    agent_mgr=agent_mgr,
                    chat_engine=chat_engine,
                )

            elif event_type == "chat_message":
                msg_data = data.get("data", {})
                content = msg_data.get("content", "").strip()
                if content:
                    game = store.get(game_id)
                    if game:
                        await handle_player_chat(
                            game_id=game_id,
                            game=game,
                            player_id=player_id,
                            content=content,
                            ws_manager=ws_manager,
                            agent_manager=agent_mgr,
                            chat_engine=chat_engine,
                        )

            elif event_type == "start_round":
                await _handle_start_round(
                    game_id=game_id,
                    player_id=player_id,
                    store=store,
                    ws_manager=ws_manager,
                    agent_mgr=agent_mgr,
                    chat_engine=chat_engine,
                )

            else:
                await ws_manager.send_to_player(
                    game_id,
                    player_id,
                    event_error(f"Unknown event type: {event_type}"),
                )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: game=%s, player=%s", game_id, player_id)
    except Exception as e:
        logger.error(
            "WebSocket error: game=%s, player=%s, error=%s",
            game_id,
            player_id,
            e,
        )
    finally:
        ws_manager.disconnect(game_id, player_id, websocket)


# ---- Client Event Handlers ----


async def _handle_player_action(
    game_id: str,
    player_id: str,
    data: dict,
    store: GameStore,
    ws_manager: WebSocketManager,
    agent_mgr: AgentManager,
    chat_engine: ChatEngine,
) -> None:
    """处理玩家操作事件"""
    game = store.get(game_id)
    if game is None:
        await ws_manager.send_to_player(game_id, player_id, event_error("游戏不存在"))
        return

    action_str = data.get("action", "")
    target_id = data.get("target")

    # 解析操作
    try:
        action = GameAction(action_str)
    except ValueError:
        logger.warning(
            "玩家操作解析失败 — game=%s, player=%s, action=%s",
            game_id,
            player_id,
            action_str,
        )
        await ws_manager.send_to_player(
            game_id,
            player_id,
            event_error(f"无效操作: {action_str}"),
        )
        return

    # 验证是否轮到该玩家（看牌操作可以在任何时候执行）
    round_state = game.current_round
    if round_state is None:
        await ws_manager.send_to_player(game_id, player_id, event_error("当前没有进行中的局"))
        return

    current_player = game.players[round_state.current_player_index]

    # 看牌操作不需要轮到自己
    if action == GameAction.CHECK_CARDS:
        player = game.get_player_by_id(player_id)
        if player is None:
            return
        if player.status != PlayerStatus.ACTIVE_BLIND:
            await ws_manager.send_to_player(game_id, player_id, event_error("已经看过牌了"))
            return
        # 直接更改玩家状态，不走 apply_action 流程（因为不是当前行动玩家）
        player.status = PlayerStatus.ACTIVE_SEEN
        # 广播看牌事件
        await _broadcast_action_result(
            game_id,
            game,
            player,
            action,
            ActionResult(
                success=True,
                action=action,
                player_id=player_id,
                amount=0,
                message=f"{player.name} 看牌",
            ),
            ws_manager,
        )
        # 如果恰好轮到自己，发送更新后的可用操作
        if current_player.id == player_id:
            from app.engine.rules import get_available_actions

            available = get_available_actions(round_state, player, game.players, game.config)
            await ws_manager.broadcast(
                game_id,
                event_turn_changed(
                    player.name,
                    player.id,
                    [a.value for a in available],
                ),
            )
        return

    if current_player.id != player_id:
        await ws_manager.send_to_player(
            game_id,
            player_id,
            event_error(f"当前轮到 {current_player.name} 行动"),
        )
        return

    # 执行操作
    try:
        result = apply_action(game, player_id, action, target_id)
    except InvalidActionError as e:
        logger.warning(
            "玩家操作非法 — game=%s, player=%s, action=%s: %s",
            game_id,
            player_id,
            action_str,
            e,
        )
        await ws_manager.send_to_player(game_id, player_id, event_error(str(e)))
        return
    except GameError as e:
        logger.error(
            "玩家操作错误 — game=%s, player=%s, action=%s: %s",
            game_id,
            player_id,
            action_str,
            e,
        )
        await ws_manager.send_to_player(game_id, player_id, event_error(str(e)))
        return

    player = game.get_player_by_id(player_id)
    if player is None:
        return

    logger.info(
        "玩家操作成功 — game=%s, player=%s, action=%s, amount=%d",
        game_id,
        player.name,
        action.value,
        result.amount,
    )

    # 广播操作结果
    await _broadcast_action_result(game_id, game, player, action, result, ws_manager)

    if result.round_ended:
        await _handle_round_end(game_id, game, result, ws_manager, agent_mgr)
        return

    # 启动 AI 回合循环（先发送 turn_changed / ai_thinking，避免 UI 卡顿）
    # 旁观反应在 AI 回合循环内部处理
    try:
        await process_ai_turns(
            game_id=game_id,
            game=game,
            ws_manager=ws_manager,
            agent_manager=agent_mgr,
            chat_engine=chat_engine,
        )
    except Exception as e:
        logger.error(
            "Error during AI turns after player action: game=%s, error=%s",
            game_id,
            e,
            exc_info=True,
        )
        await ws_manager.broadcast(
            game_id,
            event_error(f"AI 回合处理出错: {e}"),
        )

    # 收集人类行动的旁观反应（后台异步执行，不阻塞 WebSocket 消息循环）
    chat_context = ws_manager.get_chat_context(game_id)
    asyncio.create_task(
        _collect_and_broadcast_bystander_reactions(
            game_id=game_id,
            game=game,
            actor=player,
            action=action,
            result=result,
            agent_manager=agent_mgr,
            chat_engine=chat_engine,
            chat_context=chat_context,
            ws_manager=ws_manager,
        )
    )


async def _handle_start_round(
    game_id: str,
    player_id: str,
    store: GameStore,
    ws_manager: WebSocketManager,
    agent_mgr: AgentManager,
    chat_engine: ChatEngine,
) -> None:
    """处理开始新局事件"""
    game = store.get(game_id)
    if game is None:
        await ws_manager.send_to_player(game_id, player_id, event_error("游戏不存在"))
        return

    if game.status == "finished":
        await ws_manager.send_to_player(game_id, player_id, event_error("游戏已结束"))
        return

    # 如果有进行中的局
    if game.current_round is not None and game.current_round.phase == GamePhase.BETTING:
        await ws_manager.send_to_player(game_id, player_id, event_error("当前局正在进行中"))
        return

    # 重置聊天上下文
    chat_context = ws_manager.get_chat_context(game_id)
    chat_context.clear()

    # 开始新一局
    try:
        round_state = start_round(game)
    except GameError as e:
        logger.warning("开始新局失败 — game=%s: %s", game_id, e)
        await ws_manager.send_to_player(game_id, player_id, event_error(str(e)))
        return

    dealer = game.players[round_state.dealer_index]

    logger.info(
        "新局开始 — game=%s, 第%d局, 庄家=%s, 底池=%d",
        game_id,
        round_state.round_number,
        dealer.name,
        round_state.pot,
    )

    # 广播 round_started（包含完整局面信息）
    await ws_manager.broadcast(
        game_id,
        event_round_started(
            round_number=round_state.round_number,
            dealer_name=dealer.name,
            dealer_index=round_state.dealer_index,
            pot=round_state.pot,
            current_bet=round_state.current_bet,
            max_turns=game.config.max_turns,
        ),
    )

    # 广播初始游戏状态（含筹码扣除后的数据）
    await ws_manager.broadcast_game_state(game_id, game)

    # 向每个连接的玩家发送各自的手牌
    connections = ws_manager.get_connections(game_id)
    for pid in connections:
        p = game.get_player_by_id(pid)
        if p and p.hand:
            cards_data = [c.model_dump(mode="json") for c in p.hand]
            await ws_manager.send_to_player(game_id, pid, event_cards_dealt(cards_data))

    # 启动 AI 回合（如果第一个行动者是 AI）
    try:
        await process_ai_turns(
            game_id=game_id,
            game=game,
            ws_manager=ws_manager,
            agent_manager=agent_mgr,
            chat_engine=chat_engine,
        )
    except Exception as e:
        logger.error(
            "Error during AI turns after start_round: game=%s, error=%s",
            game_id,
            e,
            exc_info=True,
        )
        await ws_manager.broadcast(
            game_id,
            event_error(f"AI 回合处理出错: {e}"),
        )
