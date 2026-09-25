"""验证 Provider 凭据仅用于当前 LLM 请求，不污染其他 Agent 或进程环境。"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.base_agent import BaseAgent, LLMCallError
from app.services.provider_manager import PROVIDERS, ProviderManager

PROVIDER_MODELS = {
    "openrouter": "openrouter/synthetic-model",
    "azure_openai": "azure/synthetic-deployment",
    "zhipu": "openai/synthetic-zhipu-model",
    "siliconflow": "openai/synthetic-siliconflow-model",
}
MESSAGES = [{"role": "user", "content": "synthetic request"}]


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """所有凭据均为合成值，不读取或保留开发机上的真实凭据。"""
    monkeypatch.setattr(
        "app.agents.base_agent.get_runtime_llm_config",
        lambda: {"llm_temperature": 0.7, "llm_timeout": 5, "llm_max_retries": 2},
    )
    monkeypatch.setattr("app.api.settings.get_runtime_max_tokens", lambda: None)
    monkeypatch.setattr("asyncio.sleep", AsyncMock())
    with patch.dict(os.environ, {"SYNTHETIC_ENV": "unchanged"}, clear=True):
        yield


@pytest.fixture(params=PROVIDER_MODELS)
def provider(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> str:
    """注册隔离模型和自定义端点，覆盖全部非 Copilot Provider。"""
    provider_id = request.param
    monkeypatch.setattr(
        "app.agents.base_agent._get_all_models",
        lambda: {
            "synthetic-model": {
                "provider": provider_id,
                "model": PROVIDER_MODELS[provider_id],
            }
        },
    )
    manager = ProviderManager()
    if provider_id in {"zhipu", "siliconflow"}:
        manager.set_extra_config(
            provider_id, {"api_host": f"https://{provider_id}.example.invalid/v1"}
        )
    monkeypatch.setattr("app.services.provider_manager.get_provider_manager", lambda: manager)
    return provider_id


@pytest.fixture
def completion(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """替换网络调用，只记录实际传给 LiteLLM 的参数。"""
    response = MagicMock()
    response.choices[0].message.content = "synthetic response"
    mock = AsyncMock(return_value=response)
    monkeypatch.setattr("app.agents.base_agent.litellm.acompletion", mock)
    return mock


def make_agent(provider: str, key: str | None = None) -> BaseAgent:
    """构造携带合成凭据的 Agent。"""
    agent = BaseAgent(model_id="synthetic-model")
    if key is not None:
        agent.set_api_keys({provider: key})
    return agent


async def test_selected_key_overrides_server_key_without_environment_writes(
    provider: str, completion: AsyncMock
) -> None:
    """只传入所选 Provider 的用户 key，并保留其他调用参数和全部环境变量。"""
    for provider_id, meta in PROVIDERS.items():
        os.environ[meta["env_key"]] = f"synthetic-server-{provider_id}"
    os.environ["OPENAI_API_KEY"] = "synthetic-server-openai"
    before = dict(os.environ)
    agent = make_agent(provider)
    agent.set_api_keys({provider_id: f"synthetic-user-{provider_id}" for provider_id in PROVIDERS})

    result = await agent.call_llm(MESSAGES, temperature=0.2, max_tokens_override=128)

    assert result == "synthetic response"
    kwargs = completion.call_args.kwargs
    assert kwargs["api_key"] == f"synthetic-user-{provider}"
    assert kwargs["model"] == PROVIDER_MODELS[provider]
    assert kwargs["messages"] == MESSAGES
    assert kwargs["temperature"] == 0.2
    assert kwargs["max_tokens"] == 128
    assert kwargs["response_format"] == {"type": "json_object"}
    if provider in {"zhipu", "siliconflow"}:
        assert kwargs["api_base"] == f"https://{provider}.example.invalid/v1"
    else:
        assert "api_base" not in kwargs
    assert dict(os.environ) == before


@pytest.mark.parametrize("user_key", [None, ""])
async def test_server_environment_key_is_read_only_fallback(
    provider: str,
    completion: AsyncMock,
    user_key: str | None,
) -> None:
    """缺失或空用户 key 使用所选 Provider 的服务端 key。"""
    for provider_id, meta in PROVIDERS.items():
        os.environ[meta["env_key"]] = f"synthetic-server-{provider_id}"
    os.environ["OPENAI_API_KEY"] = "synthetic-server-openai"
    before = dict(os.environ)

    await make_agent(provider, user_key).call_llm(MESSAGES)

    assert completion.call_args.kwargs["api_key"] == f"synthetic-server-{provider}"
    assert dict(os.environ) == before


async def test_interleaved_agents_use_their_own_keys(provider: str, completion: AsyncMock) -> None:
    """A 暂停、B 进入后才读取凭据，确保异步交错不会串用 key。"""
    agent_a = make_agent(provider, "synthetic-user-a")
    agent_b = make_agent(provider, "synthetic-user-b")
    a_started = asyncio.Event()
    b_started = asyncio.Event()
    observed = {}
    response = completion.return_value
    before = dict(os.environ)

    async def interleaved_completion(**kwargs: Any) -> MagicMock:
        label = kwargs["messages"][0]["content"]
        if label == "a":
            a_started.set()
            await b_started.wait()
        else:
            await a_started.wait()
            b_started.set()
        observed[label] = kwargs.get("api_key") or os.environ.get(PROVIDERS[provider]["env_key"])
        return response

    completion.side_effect = interleaved_completion
    results = await asyncio.wait_for(
        asyncio.gather(
            agent_a.call_llm([{"role": "user", "content": "a"}]),
            agent_b.call_llm([{"role": "user", "content": "b"}]),
        ),
        timeout=5,
    )

    assert results == ["synthetic response", "synthetic response"]
    assert observed == {"a": "synthetic-user-a", "b": "synthetic-user-b"}
    assert [call.kwargs["api_key"] for call in completion.call_args_list] == [
        "synthetic-user-a",
        "synthetic-user-b",
    ]
    assert dict(os.environ) == before


@pytest.mark.parametrize("retry_succeeds", [True, False])
async def test_retry_keeps_request_key_after_another_agent_runs(
    provider: str,
    completion: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
    retry_succeeds: bool,
) -> None:
    """退避期间其他 Agent 调用或本实例更新 key，都不改变进行中的请求。"""
    agent_a = make_agent(provider, "synthetic-user-a")
    agent_b = make_agent(provider, "synthetic-user-b")
    response = completion.return_value
    completion.side_effect = [
        RuntimeError("synthetic failure"),
        response,
        response if retry_succeeds else RuntimeError("synthetic retry failure"),
    ]
    before = dict(os.environ)

    async def during_backoff(delay: float) -> None:
        await agent_b.call_llm(MESSAGES)
        agent_a.set_api_keys({provider: "synthetic-user-a-next-request"})

    monkeypatch.setattr("asyncio.sleep", during_backoff)
    if retry_succeeds:
        assert await agent_a.call_llm(MESSAGES) == "synthetic response"
    else:
        with pytest.raises(LLMCallError, match="failed after 2 retries"):
            await agent_a.call_llm(MESSAGES)

    assert [call.kwargs["api_key"] for call in completion.call_args_list] == [
        "synthetic-user-a",
        "synthetic-user-b",
        "synthetic-user-a",
    ]
    if provider in {"zhipu", "siliconflow"}:
        assert all(
            call.kwargs["api_base"] == f"https://{provider}.example.invalid/v1"
            for call in completion.call_args_list
        )
    completion.side_effect = None
    await agent_a.call_llm(MESSAGES)
    assert completion.call_args.kwargs["api_key"] == "synthetic-user-a-next-request"
    assert dict(os.environ) == before


@pytest.mark.parametrize("server_key", [None, "synthetic-server-key"])
async def test_keyless_agent_never_inherits_another_user_key(
    provider: str,
    completion: AsyncMock,
    server_key: str | None,
) -> None:
    """有 key 的用户调用后，无 key 的用户只能使用服务端配置或空凭据。"""
    if server_key:
        os.environ[PROVIDERS[provider]["env_key"]] = server_key
    before = dict(os.environ)
    keyed_agent = make_agent(provider, "synthetic-user-key")
    keyless_agent = make_agent(provider)
    keyless_agent.set_api_keys(
        {other: "synthetic-unrelated-user-key" for other in PROVIDERS if other != provider}
    )

    await keyed_agent.call_llm(MESSAGES)
    await keyless_agent.call_llm(MESSAGES)

    kwargs = completion.call_args.kwargs
    assert kwargs["api_key"] == server_key
    effective_key = kwargs["api_key"] or os.environ.get(PROVIDERS[provider]["env_key"])
    assert effective_key == server_key
    assert dict(os.environ) == before


async def test_copilot_bypasses_provider_credentials(
    completion: AsyncMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Copilot 保持原有路由，不解析或传递非 Copilot 凭据。"""
    agent = BaseAgent(model_id="copilot-gpt4o")
    agent.set_api_keys({provider: "synthetic-unused-key" for provider in PROVIDERS})
    resolve_key = MagicMock(side_effect=AssertionError("unexpected provider key lookup"))
    monkeypatch.setattr("app.agents.base_agent._get_provider_api_key", resolve_key)
    copilot = AsyncMock(return_value="synthetic copilot response")
    monkeypatch.setattr(agent, "_call_copilot", copilot)
    before = dict(os.environ)

    result = await agent.call_llm(MESSAGES, temperature=0.2, max_tokens_override=128)

    assert result == "synthetic copilot response"
    copilot.assert_awaited_once_with(
        "gpt-4o", MESSAGES, 0.2, {"type": "json_object"}, max_tokens_override=128
    )
    resolve_key.assert_not_called()
    completion.assert_not_awaited()
    assert dict(os.environ) == before
