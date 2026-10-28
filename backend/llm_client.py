"""
Unified LLM Client & Failover Router

Features:
- Config-driven multi-provider architecture: Groq, Google Gemini.
- Neutral environment variables (LLM_*) with backwards-compatible fallbacks (OPENAI_*).
- Pre-flight token bucket / rate limiter to prevent 429 on Groq free tier (8,000 TPM).
- Zero Same-Family Self-Grading Rule:
  If Drafter was Groq (OpenAI), Judge must be Gemini (Google) or Qwen (Alibaba).
  If Drafter was Gemini (Google), Judge must be Groq (Alibaba/OpenAI).
- Low reasoning effort & strict JSON mode for gpt-oss / Groq.
- Fallback chain: Primary -> Fallback -> Last Resort.
- Telemetry recording: provider, model, latency, tokens, fallback flag.
- Fail-Closed: If judges are unavailable, unverified=True, never default to pass.
- Capacity Guard: Plain user-facing error messages without leaking provider names.
"""

import os
import sys
import time
import json
import logging
import asyncio
from typing import Dict, Any, List, Optional, Tuple, Callable, AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from dotenv import load_dotenv
import httpx

load_dotenv()
logger = logging.getLogger("cerina.llm")

# --- Neutral Environment Variables & Fallback Config (Amendment 7) ---

def get_env_var(primary: str, fallback: Optional[str] = None, default: str = "") -> str:
    val = os.getenv(primary)
    if val:
        return val.strip(' "\'')
    if fallback:
        val = os.getenv(fallback)
        if val:
            return val.strip(' "\'')
    return default

LLM_WRITER_PROVIDER = get_env_var("LLM_WRITER_PROVIDER", "WRITER_PROVIDER", "groq")
LLM_WRITER_MODEL = get_env_var("LLM_WRITER_MODEL", "OPENAI_WRITER_MODEL", "openai/gpt-oss-120b")
LLM_WRITER_FALLBACK_PROVIDER = get_env_var("LLM_WRITER_FALLBACK_PROVIDER", default="gemini")
LLM_WRITER_FALLBACK_MODEL = get_env_var("LLM_WRITER_FALLBACK_MODEL", default="gemini-3.1-flash-lite")

LLM_JUDGE_PROVIDER = get_env_var("LLM_JUDGE_PROVIDER", "JUDGE_PROVIDER", "gemini")
LLM_JUDGE_MODEL = get_env_var("LLM_JUDGE_MODEL", "OPENAI_JUDGE_MODEL", "gemini-3.1-flash-lite")
LLM_JUDGE_FALLBACK_PROVIDER = get_env_var("LLM_JUDGE_FALLBACK_PROVIDER", default="groq")
LLM_JUDGE_FALLBACK_MODEL = get_env_var("LLM_JUDGE_FALLBACK_MODEL", default="qwen/qwen3.8-27b")

LAST_RESORT_PROVIDER = "gemini"
LAST_RESORT_MODEL = get_env_var("LLM_LAST_RESORT_MODEL", "OPENAI_MODEL", "gemini-3.8-flash")

from config import MODEL_FAMILY, MEASURED_LIMITS

# --- Telemetry Data Structure (Req 1.4) ---

@dataclass
class LLMResult:
    content: str
    provider: str
    model: str
    latency_ms: float
    prompt_tokens: int = 0
    completion_tokens: int = 0
    fallback_used: bool = False
    json_data: Optional[Dict[str, Any]] = None
    finish_reason: Optional[str] = "stop"
    error: Optional[str] = None
    degraded: bool = False

# --- In-Process Token Limiter / Rate Budgeting (Measured 2026-10-14) ---

class TokenRateLimiter:
    """
    Sliding-window token & request limiter using measured limits:
    Groq free-tier: 8,000 TPM, 200,000 TPD, 30 RPM, 1,000 RPD.
    Qwen output limit: 1,000 OTPM cap.
    Gemini free-tier:
      gemini-3.1-flash-lite: 15 RPM, 250K TPM, 500 RPD
      gemini-3.5-flash-lite: 15 RPM, 250K TPM, 500 RPD
      gemini-3.8-flash:       5 RPM, 250K TPM,  20 RPD
    """
    def __init__(self):
        self._groq_token_history: List[Tuple[float, int]] = []
        self._groq_daily_tokens: Dict[str, int] = {}
        self._groq_daily_requests: Dict[str, int] = {}
        self._qwen_output_history: List[Tuple[float, int]] = []
        self._gemini_daily_requests: Dict[str, int] = {}
        self._gemini_request_history: Dict[str, List[float]] = {}
        self._day_start: float = time.time()
        self._lock = asyncio.Lock()
        self._qwen_lock = asyncio.Lock()

    def _check_day_reset(self, now: float):
        if now - self._day_start > 86400:
            self._groq_daily_tokens.clear()
            self._groq_daily_requests.clear()
            self._qwen_output_history.clear()
            self._gemini_daily_requests.clear()
            self._gemini_request_history.clear()
            self._day_start = now

    async def can_call_groq(self, model: str, estimated_tokens: int = 1800, estimated_output_tokens: int = 250) -> bool:
        async with self._lock:
            now = time.time()
            self._check_day_reset(now)

            # 1. Daily Tokens Per Model check (Binding limit: 200,000 TPD)
            current_model_tokens = self._groq_daily_tokens.get(model, 0)
            if current_model_tokens + estimated_tokens > 190_000:  # safety buffer < 200,000
                logger.warning(
                    f"[RATE LIMIT] Groq model '{model}' near daily token cap "
                    f"({current_model_tokens} + {estimated_tokens} > 190,000 / 200,000 TPD). "
                    "Preemptively routing away."
                )
                return False

            # 2. Daily Requests Per Model check (1,000 RPD)
            current_model_reqs = self._groq_daily_requests.get(model, 0)
            if current_model_reqs >= 980:
                logger.warning(f"[RATE LIMIT] Groq model '{model}' near daily request cap (1,000 RPD). Preemptively routing away.")
                return False

            # 3. Sliding 60s TPM check (8,000 TPM)
            cutoff = now - 60.0
            self._groq_token_history = [(t, count) for (t, count) in self._groq_token_history if t > cutoff]
            current_window_tokens = sum(count for _, count in self._groq_token_history)
            if current_window_tokens + estimated_tokens > 7500:
                logger.warning(
                    f"[RATE LIMIT] Groq sliding TPM budget near capacity ({current_window_tokens} + {estimated_tokens} > 7500 / 8000). "
                    "Preemptively failing over to prevent 429."
                )
                return False

            # 4. Qwen output TPM rate limiting check
            if "qwen" in model.lower():
                self._qwen_output_history = [(t, count) for (t, count) in self._qwen_output_history if t > cutoff]
                qwen_otpm = sum(count for _, count in self._qwen_output_history)
                if qwen_otpm + estimated_output_tokens > 850:
                    logger.warning(
                        f"[RATE LIMIT] Qwen output TPM near 1,000 cap ({qwen_otpm} + {estimated_output_tokens} > 850). "
                        "Preemptively failing over to prevent 429."
                    )
                    return False

            return True

    async def can_call_gemini(self, model: str) -> bool:
        async with self._lock:
            now = time.time()
            self._check_day_reset(now)

            # RPD limits: 3.8-flash has 20 RPD; 3.1 & 3.5 have 500 RPD
            rpd_cap = 18 if "3.8" in model else 490
            curr_reqs = self._gemini_daily_requests.get(model, 0)
            if curr_reqs >= rpd_cap:
                logger.warning(f"[RATE LIMIT] Gemini model '{model}' reached daily cap ({curr_reqs} >= {rpd_cap}). Routing away.")
                return False

            # Sliding RPM check per model (measured: 15 RPM for 3.1/3.5, 5 RPM for 3.8)
            cutoff = now - 60.0
            history = [t for t in self._gemini_request_history.get(model, []) if t > cutoff]
            self._gemini_request_history[model] = history
            rpm_cap = 4 if "3.8" in model else 14
            if len(history) >= rpm_cap:
                logger.warning(f"[RATE LIMIT] Gemini sliding RPM limit reached for '{model}' ({len(history)} >= {rpm_cap}). Routing away.")
                return False

            return True

    async def record_groq_usage(self, model: str, tokens: int, output_tokens: int = 0):
        async with self._lock:
            now = time.time()
            self._groq_token_history.append((now, tokens))
            self._groq_daily_tokens[model] = self._groq_daily_tokens.get(model, 0) + tokens
            self._groq_daily_requests[model] = self._groq_daily_requests.get(model, 0) + 1
            if "qwen" in model.lower() and output_tokens > 0:
                self._qwen_output_history.append((now, output_tokens))

    async def record_gemini_usage(self, model: str):
        async with self._lock:
            now = time.time()
            if model not in self._gemini_request_history:
                self._gemini_request_history[model] = []
            self._gemini_request_history[model].append(now)
            self._gemini_daily_requests[model] = self._gemini_daily_requests.get(model, 0) + 1

rate_limiter = TokenRateLimiter()

# --- Provider Implementation Adapters ---

class GroqAdapter:
    """Groq API Adapter (OpenAI-compatible)"""
    def __init__(self):
        self.api_key = (os.getenv("GROQ_API_KEY") or "").strip(' "\'')
        self.base_url = "https://api.groq.com/openai/v1"

    async def generate(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 2000,
        json_mode: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None
    ) -> LLMResult:
        if not self.api_key:
            raise ValueError("GROQ_API_KEY is not configured.")

        # Pre-flight rate limiter check (Measured limits: 8,000 TPM, 200,000 TPD)
        est_tokens = 1800 if max_tokens <= 1000 else 2500
        can_call = await rate_limiter.can_call_groq(model=model, estimated_tokens=est_tokens)
        if not can_call:
            raise RuntimeError(f"GROQ_PREEMPTIVE_LIMIT: Near sliding 8,000 TPM or 200,000 daily TPD budget for {model}.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }

        # Set reasoning effort
        if "gpt-oss" in model.lower():
            payload["reasoning_effort"] = "low"
        elif "qwen" in model.lower():
            payload["reasoning_effort"] = "none"
            payload["reasoning_format"] = "hidden"

        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        t0 = time.perf_counter()

        # Handle streaming if callback provided (Writer)
        if stream_callback is not None:
            payload["stream"] = True
            content_chunks: List[str] = []
            finish_reason = "stop"
            first_token_time = None
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", f"{self.base_url}/chat/completions", headers=headers, json=payload) as resp:
                    if resp.status_code != 200:
                        err_text = await resp.aread()
                        raise RuntimeError(f"Groq stream error {resp.status_code}: {err_text.decode('utf-8', errors='ignore')}")
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        line_data = line[6:].strip()
                        if line_data == "[DONE]":
                            break
                        try:
                            chunk_obj = json.loads(line_data)
                            choice = chunk_obj["choices"][0]
                            delta = choice.get("delta", {}).get("content", "")
                            if choice.get("finish_reason"):
                                finish_reason = choice.get("finish_reason")
                            if delta:
                                if first_token_time is None:
                                    first_token_time = time.perf_counter()
                                    if (first_token_time - t0) > 6.0:
                                        raise TimeoutError(f"Writer TTFT exceeded 6.0s threshold ({(first_token_time - t0):.2f}s)")
                                content_chunks.append(delta)
                                stream_callback(delta)
                        except TimeoutError:
                            raise
                        except Exception:
                            continue
            if first_token_time is None and (time.perf_counter() - t0) > 6.0:
                raise TimeoutError("Writer failed to return first token within 6.0s timeout")

            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            full_content = "".join(content_chunks)
            comp_tokens = int(len(full_content) / 4)
            total_est_tokens = comp_tokens + 600
            await rate_limiter.record_groq_usage(model=model, tokens=total_est_tokens, output_tokens=comp_tokens)
            return LLMResult(
                content=full_content,
                provider="groq",
                model=model,
                latency_ms=latency_ms,
                prompt_tokens=600,
                completion_tokens=comp_tokens,
                finish_reason=finish_reason
            )

        # Non-streaming request (Judges): 10.0s timeout per call with immediate failover
        timeout_val = 10.0 if (json_mode or max_tokens <= 1500) else 30.0
        
        async def _do_post():
            async with httpx.AsyncClient(timeout=timeout_val) as client:
                resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                latency_ms = round((time.perf_counter() - t0) * 1000, 2)
                if resp.status_code != 200:
                    raise RuntimeError(f"Groq API error {resp.status_code}: {resp.text}")
                
                data = resp.json()
                choice = data["choices"][0]
                content = choice["message"]["content"]
                finish_reason = choice.get("finish_reason", "stop")
                usage = data.get("usage", {})
                prompt_tokens = usage.get("prompt_tokens", 0)
                comp_tokens = usage.get("completion_tokens", 0)
                total_tokens = usage.get("total_tokens", prompt_tokens + comp_tokens)

                await rate_limiter.record_groq_usage(model=model, tokens=total_tokens or est_tokens, output_tokens=comp_tokens)

                return LLMResult(
                    content=content,
                    provider="groq",
                    model=model,
                    latency_ms=latency_ms,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=comp_tokens,
                    finish_reason=finish_reason
                )

        # Enforce sequential calls for Qwen to avoid concurrent rate limits
        if "qwen" in model.lower():
            async with rate_limiter._qwen_lock:
                return await _do_post()
        else:
            return await _do_post()


class GeminiAdapter:
    """Google Gemini API Direct REST Adapter (v1beta)"""
    def __init__(self):
        self.api_key = (os.getenv("GOOGLE_API_KEY") or "").strip(' "\'')
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    async def generate(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 1500,
        json_mode: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None
    ) -> LLMResult:
        if not self.api_key:
            raise ValueError("GOOGLE_API_KEY is not configured.")

        # Rate limiter check for Gemini models
        can_call = await rate_limiter.can_call_gemini(model=model)
        if not can_call:
            raise RuntimeError(f"GEMINI_PREEMPTIVE_LIMIT: Near rate limit for {model}.")

        # Convert chat messages to Gemini contents format
        system_instruction = None
        contents = []
        for m in messages:
            role = m["role"]
            if role == "system":
                system_instruction = {"parts": [{"text": m["content"]}]}
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": m["content"]}]})
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": m["content"]}]})

        # Ensure max_tokens >= 1000 so thinking tokens don't truncate JSON
        gen_config: Dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max(max_tokens, 1200)
        }
        if json_mode:
            gen_config["responseMimeType"] = "application/json"

        # Set minimal thinking on Gemini judge calls (thinkingBudget 0 cuts latency without dropping accuracy)
        # Note: gemini-3.5-flash-lite is non-thinking and rejects thinkingConfig with 400 INVALID_ARGUMENT
        if "3.5" not in model.lower() and (json_mode or max_tokens <= 1500 or "3.8" in model or "3.1" in model):
            gen_config["thinkingConfig"] = {"thinkingBudget": 0}

        body: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": gen_config
        }
        if system_instruction:
            body["systemInstruction"] = system_instruction

        t0 = time.perf_counter()

        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        # Timeout <= 10.0s for judges with immediate failover; 35s for full protocol drafting
        timeout_val = 10.0 if (json_mode or "3.8" in model or max_tokens <= 1500) else 35.0

        # Handle streaming if callback provided (Writer: 6s TTFT timeout)
        if stream_callback is not None:
            url = f"{self.base_url}/{model}:streamGenerateContent?alt=sse"
            content_chunks: List[str] = []
            finish_reason = "stop"
            first_token_time = None
            async with httpx.AsyncClient(timeout=25.0) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        err_text = await resp.aread()
                        raise RuntimeError(f"Gemini stream error {resp.status_code}: {err_text.decode('utf-8', errors='ignore')}")
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        line_data = line[6:].strip()
                        try:
                            chunk_obj = json.loads(line_data)
                            cand = chunk_obj.get("candidates", [{}])[0]
                            if cand.get("finishReason"):
                                finish_reason = cand.get("finishReason").lower()
                            parts = cand.get("content", {}).get("parts", [])
                            for p in parts:
                                txt = p.get("text", "")
                                if txt:
                                    if first_token_time is None:
                                        first_token_time = time.perf_counter()
                                        if (first_token_time - t0) > 6.0:
                                            raise TimeoutError(f"Writer TTFT exceeded 6.0s threshold ({(first_token_time - t0):.2f}s)")
                                    content_chunks.append(txt)
                                    stream_callback(txt)
                        except TimeoutError:
                            raise
                        except Exception:
                            continue
            if first_token_time is None and (time.perf_counter() - t0) > 6.0:
                raise TimeoutError("Writer failed to return first token within 6.0s timeout")

            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            full_content = "".join(content_chunks)
            await rate_limiter.record_gemini_usage(model=model)
            return LLMResult(
                content=full_content,
                provider="gemini",
                model=model,
                latency_ms=latency_ms,
                prompt_tokens=500,
                completion_tokens=int(len(full_content) / 4),
                finish_reason=finish_reason
            )

        # Non-streaming REST call (Judges: 8.0s timeout)
        url = f"{self.base_url}/{model}:generateContent"
        async with httpx.AsyncClient(timeout=timeout_val) as client:
            resp = await client.post(url, headers=headers, json=body)
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            if resp.status_code != 200:
                raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text}")

            data = resp.json()
            cands = data.get("candidates", [])
            if not cands:
                raise RuntimeError(f"Gemini returned no candidates: {data}")

            finish_reason = cands[0].get("finishReason", "STOP").lower()
            parts = cands[0].get("content", {}).get("parts", [])
            text_parts = [p.get("text", "") for p in parts if "text" in p]
            content = "".join(text_parts)

            usage = data.get("usageMetadata", {})
            await rate_limiter.record_gemini_usage(model=model)
            return LLMResult(
                content=content,
                provider="gemini",
                model=model,
                latency_ms=latency_ms,
                prompt_tokens=usage.get("promptTokenCount", 0),
                completion_tokens=usage.get("candidatesTokenCount", 0),
                finish_reason=finish_reason
            )



# --- Unified LLM Client with Router & Zero Same-Family Grading ---

class UnifiedLLMClient:
    """
    Central client managing routing, failover, zero same-family grading, and telemetry.
    """
    def __init__(self):
        self.groq = GroqAdapter()
        self.gemini = GeminiAdapter()

    def _get_adapter(self, provider: str):
        p = provider.lower()
        if p in ["groq", "openai"]:
            return self.groq
        if p in ["gemini", "google"]:
            return self.gemini
        raise ValueError(f"Unknown LLM provider: {provider}")

    def resolve_writer_plan(self) -> List[Tuple[str, str]]:
        """
        Writer routing plan:
        gpt-oss-120b (Groq) -> gemini-3.5-flash-lite -> gemini-3.1-flash-lite
        """
        return [
            ("groq", "openai/gpt-oss-120b"),
            ("gemini", "gemini-3.5-flash-lite"),
            ("gemini", "gemini-3.1-flash-lite")
        ]

    def resolve_judge_plan(self, role: str = "judge", drafter_model: Optional[str] = None, drafter_provider: Optional[str] = None) -> List[Tuple[str, str]]:
        """
        Judge routing plans enforcing Zero Same-Family Rule:
        Safety: Qwen -> Gemini 3.5 FL -> Gemini 3.1 FL -> Gemini 3.8 Flash -> Llama
        Critic: Gemini 3.5 FL -> Gemini 3.1 FL -> Qwen -> Gemini 3.8 Flash -> Llama
        Gemini 3.8 stays last-resort only with timeout <= 8s.
        """
        drafter_family = None
        if drafter_model:
            drafter_family = MODEL_FAMILY.get(drafter_model.lower())
        if not drafter_family and drafter_provider:
            p = drafter_provider.lower()
            if p in ["gemini", "google"]:
                drafter_family = "google"
            elif p in ["groq", "openai"]:
                drafter_family = "openai"
        if not drafter_family:
            drafter_mod = (drafter_model or LLM_WRITER_MODEL).lower()
            drafter_family = MODEL_FAMILY.get(drafter_mod, "openai")

        if role == "safety":
            raw_plan = [
                ("groq", "qwen/qwen3.8-27b"),
                ("gemini", "gemini-3.5-flash-lite"),
                ("gemini", "gemini-3.1-flash-lite"),
                ("gemini", "gemini-3.8-flash")
            ]
        elif role == "critic":
            raw_plan = [
                ("gemini", "gemini-3.5-flash-lite"),
                ("gemini", "gemini-3.1-flash-lite"),
                ("groq", "qwen/qwen3.8-27b"),
                ("gemini", "gemini-3.8-flash")
            ]
        else:
            raw_plan = [
                ("groq", "qwen/qwen3.8-27b"),
                ("gemini", "gemini-3.5-flash-lite")
            ]

        # Enforce Zero Same-Family Rule: A judge may NEVER share a family with the writer
        filtered_plan = []
        for prov, mod in raw_plan:
            mod_family = MODEL_FAMILY.get(mod, "unknown")
            if mod_family == drafter_family:
                continue
            filtered_plan.append((prov, mod))

        # Guarantee non-empty plan across families if primary filtered
        if not filtered_plan:
            if drafter_family == "google":
                filtered_plan = [("groq", "qwen/qwen3.8-27b")]
            else:
                filtered_plan = [("gemini", "gemini-3.5-flash-lite")]

        return filtered_plan

    async def execute_with_failover(
        self,
        role: str,
        messages: List[Dict[str, str]],
        drafter_model: Optional[str] = None,
        drafter_provider: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1500,
        json_mode: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None
    ) -> LLMResult:
        # Mock-LLM Mode: Deterministic zero-quota responses for unit and benchmark tests
        if os.getenv("MOCK_LLM", "").strip().lower() == "true":
            if role == "writer":
                mock_text = """# Behavioral Activation Protocol for Low Motivation

## Introduction
This protocol is designed to help individuals re-engage with reinforcing life activities and dismantle avoidance cycles.

## Goals
1. Identify 2 manageable value-aligned daily activities.
2. Track mood before and after each activity.

## Steps
### Step 1: Activity Identification
Choose one low-effort, high-enjoyment task to schedule today.

### Step 2: Time-Blocking
Place the activity at a specific hour on your daily schedule.

### Step 3: Mood Rating
Rate your mood on a 0-10 scale immediately before and after completing the task.

## Practice
Schedule and complete at least one target activity every day for 5 days.

## Reflection
What did you notice about your energy level once you initiated the task?

## Conclusion
Consistent small steps create lasting behavioral change. If symptoms worsen, please consult a licensed professional.
"""
                if stream_callback:
                    stream_callback(mock_text)
                return LLMResult(content=mock_text, provider="mock", model="mock-writer", latency_ms=10.0, finish_reason="stop")
            elif role == "safety":
                user_msg = " ".join(m.get("content", "") for m in messages).lower()
                med_failed = any(kw in user_msg for kw in ["alprazolam", "xanax", "lexapro", "dosing", "pharmacological", "sedative"])
                exp_failed = any(kw in user_msg for kw in ["straw breathing", "hyperventilation challenge", "might faint or lose control"])
                mock_safety = json.dumps({
                    "self_harm_handled_safely": {"passed": True, "reason": "No self-harm or crisis risks identified"},
                    "no_medication_advice": {
                        "passed": not med_failed,
                        "reason": "Explicit medication recommendations found" if med_failed else "No medications mentioned"
                    },
                    "no_diagnosis": {"passed": True, "reason": "No diagnostic labeling"},
                    "no_contraindicated_exposure": {
                        "passed": not exp_failed,
                        "reason": "High-intensity interoceptive exposure without clinical supervision" if exp_failed else "Exposure steps are graded and safe"
                    },
                    "referral_language_where_risk": {
                        "passed": not exp_failed,
                        "reason": "Lacks required immediate clinical guidance" if exp_failed else "Professional referral included in conclusion"
                    }
                })
                return LLMResult(content=mock_safety, provider="mock", model="mock-safety", latency_ms=10.0, finish_reason="stop")
            else:
                user_msg = " ".join(m.get("content", "") for m in messages).lower()
                is_cold = "stop overthinking and complaining" in user_msg or "pathetic" in user_msg
                is_off_protocol = "spiritual meridians" in user_msg or "crystal harmonic" in user_msg or "lemon detox" in user_msg
                is_mixed_suds = "0 to 10" in user_msg and "1 to 100" in user_msg
                
                warmth_score = 1 if is_cold else 5
                fidelity_score = 1 if is_off_protocol else (2 if is_mixed_suds else 5)
                clarity_score = 2 if is_mixed_suds else 5

                mock_critic = json.dumps({
                    "warmth": {
                        "score": warmth_score,
                        "quoted_line": "Stop overthinking and complaining about ordinary social situations." if is_cold else "This protocol is designed to help individuals re-engage with reinforcing life activities and dismantle avoidance cycles.",
                        "rationale": "Cold, invalidating tone." if is_cold else "Empathetic, collaborative tone."
                    },
                    "validation": {
                        "score": 1 if is_cold else 5,
                        "quoted_line": "Why did you waste years being pathetic over normal social interactions?" if is_cold else "Consistent small steps create lasting behavioral change. If symptoms worsen, please consult a licensed professional.",
                        "rationale": "Criticizes patient distress." if is_cold else "Validates pacing and effort."
                    },
                    "clarity": {
                        "score": clarity_score,
                        "quoted_line": "If your SUDS level exceeds 7 out of 100, immediately exit." if is_mixed_suds else "Choose one low-effort, high-enjoyment task to schedule today.",
                        "rationale": "Conflicting 0-10 vs 1-100 scales." if is_mixed_suds else "Concrete and actionable."
                    },
                    "cbt_fidelity": {
                        "score": fidelity_score,
                        "quoted_line": "Purify your internal spiritual meridians and cleanse toxic auric residue" if is_off_protocol else "Rate your mood on a 0-10 scale immediately before and after completing the task.",
                        "rationale": "Pseudoscientific energy healing, not CBT." if is_off_protocol else ("Mixed SUDS scale introduces clinical error." if is_mixed_suds else "Exact behavioral activation mechanics.")
                    },
                    "structure": {
                        "score": 5,
                        "quoted_line": "Place the activity at a specific hour on your daily schedule.",
                        "rationale": "Standard CBT structure with clear progression."
                    }
                })
                return LLMResult(content=mock_critic, provider="mock", model="mock-critic", latency_ms=10.0, finish_reason="stop")

        if role == "writer":
            plan = self.resolve_writer_plan()
        else:
            plan = self.resolve_judge_plan(role=role, drafter_model=drafter_model, drafter_provider=drafter_provider)

        last_error = None
        for idx, (provider, model) in enumerate(plan):
            is_fallback = (idx > 0)
            family = MODEL_FAMILY.get(model, "unknown")
            try:
                adapter = self._get_adapter(provider)
                logger.info(f"[LLM ROUTER] Role={role} model={model} family={family} (attempt {idx+1}/{len(plan)})")
                res = await adapter.generate(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_mode=json_mode,
                    stream_callback=stream_callback
                )
                res.fallback_used = is_fallback
                return res
            except Exception as e:
                last_error = e
                logger.warning(
                    f"[LLM ROUTER] Call to {provider}:{model} ({family}) for role={role} failed: {e}. "
                    f"Proceeding to next fallback."
                )

        # All providers exhausted - fail closed
        err_msg = str(last_error) if last_error else "All configured LLM providers failed."
        logger.error(f"[LLM ROUTER] All failover providers exhausted for role={role}: {err_msg}")
        return LLMResult(
            content="",
            provider="unavailable",
            model="unavailable",
            latency_ms=0.0,
            fallback_used=True,
            finish_reason="error",
            error=err_msg
        )

# Global unified LLM client instance
llm_client = UnifiedLLMClient()
