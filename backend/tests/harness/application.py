"""测试专用替身：脚本决策、固定洗牌、无外部模型调用；产品规则保持原样。"""

from __future__ import annotations

import json
from functools import partial
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from app.agents import agent_manager
from app.agents.base_agent import BaseAgent, Decision, ThoughtData
from app.agents.chat_engine import ChatEngine, TriggerEvent
from app.config import ALL_MODELS, OPENROUTER_MODELS
from app.engine import game_manager
from app.engine.deck import Deck
from app.models.chat import BystanderReaction, ChatContext
from app.models.game import GameAction, GameState, Player

MODEL_ID = "harness-call-then-fold"
NARRATIVE = "脚本对手先跟注，再弃牌；此记录由隔离测试生成。"


class ScriptedAgent(BaseAgent):
    """每局第一次行动跟注，之后弃牌；记录仍由真实 WS/数据库路径写入。"""

    decisions = 0
    narratives = 0

    async def make_decision(
        self,
        game: GameState,
        player: Player,
        chat_context: list[dict[str, str]] | None = None,
    ) -> Decision:
        assert game.current_round is not None
        number = game.current_round.round_number
        action = GameAction.FOLD if self.get_round_thoughts(number) else GameAction.CALL
        thought = ThoughtData(reasoning=f"scripted:{action.value}", confidence=1.0)
        self.memory.round_thoughts.setdefault(number, []).append(thought)
        ScriptedAgent.decisions += 1
        return Decision(action=action, thought=thought, raw_response="scripted")

    async def call_llm(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        response_format: dict | None = None,
        max_tokens_override: int | None = None,
    ) -> str:
        """叙事的模型边界替身，保留真实 reporter 和持久化流程。"""
        ScriptedAgent.narratives += 1
        return json.dumps({"narrative": NARRATIVE, "outcome": "scripted"}, ensure_ascii=False)


class SilentChatEngine(ChatEngine):
    """关闭非必要的随机旁观发言，不改变行动、结算或读写路径。"""

    async def collect_bystander_reactions(
        self,
        event: TriggerEvent,
        bystanders: list[BaseAgent],
        chat_context: ChatContext,
        agent_states: dict[str, dict[str, Any]] | None = None,
    ) -> list[BystanderReaction]:
        return []


def create_harness_app(
    directory: Path, blocked_network: list[str], provider_attempts: list[str],
) -> FastAPI:
    """在独立进程内注入替身，不向产品入口增加测试开关或路由。"""
    import app.logging_config as logging_config

    # main 导入时会创建 app，先将日志也放入该进程拥有的临时目录。
    logging_config.setup_logging = partial(
        logging_config.setup_logging, log_dir=str(directory / "logs")
    )
    from app.api import websocket
    from app.main import app

    model = {"model": MODEL_ID, "display_name": "Scripted opponent", "provider": "scripted"}
    OPENROUTER_MODELS[MODEL_ID] = model
    ALL_MODELS[MODEL_ID] = model
    agent_manager.BaseAgent = ScriptedAgent
    websocket.ChatEngine = SilentChatEngine
    # 只替换随机输入；start_round/apply_action/settle_round 全部执行原实现。
    game_manager.Deck = partial(Deck, seed=20260926)

    async def forbidden_provider(*args: Any, **kwargs: Any) -> str:
        provider_attempts.append("unexpected provider call")
        raise AssertionError("Real providers are disabled in the integration harness")

    BaseAgent.call_llm = forbidden_provider
    BaseAgent._call_copilot = forbidden_provider

    @app.get("/__harness__/", response_class=HTMLResponse)
    async def browser_origin() -> str:
        """原生 fetch/WebSocket 的同源空页面，不加载产品 UI。"""
        return "<!doctype html><html lang='en'><title>Backend transport harness</title></html>"

    @app.get("/__harness__/diagnostics")
    async def diagnostics() -> dict[str, Any]:
        return {
            "provider_attempts": provider_attempts,
            "blocked_network": blocked_network,
            "scripted_decisions": ScriptedAgent.decisions,
            "scripted_narratives": ScriptedAgent.narratives,
        }

    return app
