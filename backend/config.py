"""
Central Configuration for Measured Provider Limits & Routing Config.
Values strictly match measured quotas (2026-10-14).
"""

import logging

logger = logging.getLogger("cerina.config")

# Model family taxonomy for Zero Same-Family Rule (L1)
MODEL_FAMILY = {
    # OpenAI family
    "openai/gpt-oss-120b": "openai",
    "openai/gpt-oss-20b": "openai",
    
    # Google family
    "gemini-3.1-flash-lite": "google",
    "gemini-3.5-flash-lite": "google",
    "gemini-3.8-flash": "google",
    
    # Alibaba family
    "qwen/qwen3.8-27b": "alibaba"
}

# Measured limits from AI Studio and Groq Console (2026-10-14)
MEASURED_LIMITS = {
    "gemini": {
        "gemini-3.1-flash-lite": {
            "rpm": 15,
            "tpm": 250_000,
            "rpd": 500,
            "tpd": None,
            "source": "AI Studio > Rate Limit (project: new-CBT-project)",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        },
        "gemini-3.5-flash-lite": {
            "rpm": 15,
            "tpm": 250_000,
            "rpd": 500,
            "tpd": None,
            "source": "AI Studio > Rate Limit (project: new-CBT-project)",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        },
        "gemini-3.8-flash": {
            "rpm": 5,
            "tpm": 250_000,
            "rpd": 20,
            "tpd": None,
            "source": "AI Studio > Rate Limit (project: new-CBT-project)",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        }
    },
    "groq": {
        "openai/gpt-oss-120b": {
            "rpm": 30,
            "tpm": 8_000,
            "rpd": 1_000,
            "tpd": 200_000,
            "binding_limit": "tpd",
            "source": "Groq Console > Settings > Project Limits",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        },
        "openai/gpt-oss-20b": {
            "rpm": 30,
            "tpm": 8_000,
            "rpd": 1_000,
            "tpd": 200_000,
            "binding_limit": "tpd",
            "source": "Groq Console > Settings > Project Limits",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        },
        "qwen/qwen3.8-27b": {
            "rpm": 30,
            "tpm": 8_000,
            "rpd": 1_000,
            "tpd": 200_000,
            "binding_limit": "tpd",
            "source": "Groq Console > Settings > Project Limits",
            "date_measured": "2026-10-14",
            "reset_type": "UTC midnight"
        }
    }
}

def log_limits_on_startup():
    """Logs active provider measured limits at system startup without secrets"""
    logger.info("================ PROVIDER LIMIT CONFIG (Measured 2026-10-14) ================")
    for provider, models in MEASURED_LIMITS.items():
        for model_name, cfg in models.items():
            tpd_str = f", TPD={cfg['tpd']:,}" if cfg.get("tpd") else ""
            logger.info(
                f"[{provider.upper()}] {model_name}: {cfg['rpm']} RPM, {cfg['tpm']:,} TPM, {cfg['rpd']} RPD{tpd_str} "
                f"(Reset: {cfg['reset_type']}, Source: {cfg['source']})"
            )
    logger.info("=============================================================================")
