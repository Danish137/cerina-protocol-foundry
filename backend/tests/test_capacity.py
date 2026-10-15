import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from security import get_capacity_status, record_llm_call
from llm_client import TokenRateLimiter

@pytest.mark.asyncio
async def test_token_rate_limiter_qwen_otpm():
    """Test sliding Qwen OTPM rate limiter (1,000 cap)."""
    limiter = TokenRateLimiter()
    # 1. Under cap: can call
    can_call = await limiter.can_call_groq("qwen/qwen3.8-27b", estimated_tokens=500, estimated_output_tokens=250)
    assert can_call is True

    # 2. Simulate 800 output tokens used recently
    await limiter.record_groq_usage("qwen/qwen3.8-27b", tokens=1200, output_tokens=800)

    # 3. Next call with 250 output tokens would exceed 850 safety threshold
    can_call_next = await limiter.can_call_groq("qwen/qwen3.8-27b", estimated_tokens=500, estimated_output_tokens=250)
    assert can_call_next is False

@pytest.mark.asyncio
async def test_token_rate_limiter_groq_tpd():
    """Test Groq 200,000 TPD binding limiter."""
    limiter = TokenRateLimiter()
    # 1. Under cap: can call
    can_call = await limiter.can_call_groq("openai/gpt-oss-120b", estimated_tokens=2000)
    assert can_call is True

    # 2. Simulate near daily cap (192,000 tokens used)
    await limiter.record_groq_usage("openai/gpt-oss-120b", tokens=192_000)

    # 3. Next call exceeding 190,000 safety threshold is blocked
    can_call_next = await limiter.can_call_groq("openai/gpt-oss-120b", estimated_tokens=2000)
    assert can_call_next is False

def test_capacity_status_formula():
    """
    Test F9 capacity formula:
    Runs left = min(writer_runs, safety_runs, critic_runs)
    Each term = (sum over role providers tokens) / (calls_per_run * tokens_per_call) * 0.90
    """
    status = get_capacity_status()
    assert "remaining_runs_estimate" in status
    assert "writer_runs" in status
    assert "safety_runs" in status
    assert "critic_runs" in status
    assert status["remaining_runs_estimate"] == min(status["writer_runs"], status["safety_runs"], status["critic_runs"])
    assert status["remaining_runs_estimate"] >= 0
    assert status["exhausted"] is False or status["remaining_runs_estimate"] == 0
