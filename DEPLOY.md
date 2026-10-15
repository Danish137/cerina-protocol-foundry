# Cerina Protocol Foundry — Deployment & Environment Configuration

This document provides deployment guidelines, required environment variables, empirically measured rate limits, and provider failover policies for Cerina Protocol Foundry.

---

## 1. Environment Variables Reference

Cerina Protocol Foundry uses **neutral `LLM_*` environment variable names**, with backwards-compatible fallbacks to legacy `OPENAI_*` names where applicable.

### API Keys
| Variable | Required / Optional | Description |
|---|---|---|
| `GROQ_API_KEY` | **Required** (for primary writer) | GroqCloud API key for ultra-fast LPU inference (`openai/gpt-oss-120b`). |
| `GOOGLE_API_KEY` | **Required** (for primary judge) | Google AI Studio API key for Gemini inference (`gemini-3.1-flash-lite` / `gemini-3.5-flash-lite`). |
| `OPENROUTER_API_KEY` | Optional (resilient fallback) | OpenRouter API key for tertiary failover (`meta-llama/llama-3.3-70b-instruct`). |

### Model & Provider Configuration
| Neutral Variable | Default Value | Purpose |
|---|---|---|
| `LLM_WRITER_PROVIDER` | `groq` | Primary protocol drafting provider. |
| `LLM_WRITER_MODEL` | `openai/gpt-oss-120b` | Primary protocol drafting model (~4.0s generation). |
| `LLM_WRITER_FALLBACK_PROVIDER` | `gemini` | Fallback drafter if Groq is unavailable. |
| `LLM_WRITER_FALLBACK_MODEL` | `gemini-3.1-flash-lite` | Fallback drafting model. |
| `LLM_JUDGE_PROVIDER` | `gemini` | Primary clinical & safety judge provider. |
| `LLM_JUDGE_MODEL` | `gemini-3.1-flash-lite` | Primary judge model (100% canary accuracy). |
| `LLM_JUDGE_FALLBACK_PROVIDER` | `groq` | Fallback judge provider. |
| `LLM_JUDGE_FALLBACK_MODEL` | `qwen/qwen3.8-27b` | Fallback judge model (1.1s–1.8s latency). |
| `LLM_LAST_RESORT_PROVIDER` | `openrouter` | Emergency tertiary failover provider. |
| `LLM_LAST_RESORT_MODEL` | `meta-llama/llama-3.3-70b-instruct` | Emergency tertiary model. |

### Application & Database Configuration
| Variable | Default Value | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./cerina_foundry.db` | SQLite database URI for sessions, events, and LangGraph checkpoints. |
| `HOST` | `0.0.0.0` | Backend bind host. |
| `PORT` | `8000` | Backend bind port. |
| `DAILY_LLM_BUDGET` | `1000` | Daily request budget counter. |
| `SESSION_TTL_DAYS` | `7` | Retention purge threshold for inactive sessions. |

---

## 2. Zero Same-Family Self-Grading Rule

To maintain strict clinical independence, the unified LLM client router enforces that **an AI model never grades its own family's output**:
- **Family Mapping**:
  - `openai/gpt-oss-120b`, `openai/gpt-oss-20b` -> `openai`
  - `gemini-*` -> `google`
  - `qwen/qwen3.8-27b` -> `alibaba`
  - `meta-llama/*` -> `meta`
- If the draft was written by **Groq (`openai` family)**, judges are assigned to **Google Gemini** or **Meta Llama**.
- If the writer fails over to **Gemini (`google` family)**, judges automatically switch to **Groq (`alibaba` family)** or **Meta Llama**.
- A model family never grades itself.

---

## 3. Measured Free-Tier Rate Limits & Capacity

Empirically verified against provider consoles (2026-10-14):
- **Groq Free Tier**:
  - **Requests Per Day (RPD)**: 1,000 RPD
  - **Tokens Per Day (TPD)**: 200,000 TPD (**Binding limit**: ~105 calls/day at ~1,850 tokens/call)
  - **Tokens Per Minute (TPM)**: 8,000 TPM
- **Google Gemini Free Tier**:
  - `gemini-3.1-flash-lite`: 15 RPM, 250,000 TPM, 500 RPD (reset at 00:00 UTC)
  - `gemini-3.5-flash-lite`: 15 RPM, 250,000 TPM, 500 RPD (reset at 00:00 UTC)
  - `gemini-3.8-flash`: 5 RPM, 250,000 TPM, 20 RPD (emergency last-resort only)

**Live Runs Left Today** calculation considers both primary and fallback chains:
$$\text{Remaining Runs} = \left\lfloor (\text{Chain1 Runs} + \text{Chain2 Runs}) \times 0.90 \right\rfloor$$

---

## 4. Local & Production Deployment

### Backend Setup
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Start backend server
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run build
npm run preview -- --port 3000
```
