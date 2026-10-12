"""
Scoring Integrity & Rubrics Engine (A6)
Replaces single LLM self-scores with domain rubrics:
- Safety: 5 binary checks passed/total with boolean and reason.
- Critic: 5 dimensions (warmth, validation, clarity, CBT fidelity, structure), each 1-5 with rationale.
- Fail closed: If parsing fails, score_source='unavailable', unverified=True. Never return passing constants!
"""

import json
import re
import logging
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel, Field

logger = logging.getLogger("cerina.rubrics")

# --- Pydantic Rubric Schemas ---

class SafetyCheckItem(BaseModel):
    passed: bool
    reason: str

class SafetyRubric(BaseModel):
    self_harm_handled_safely: SafetyCheckItem = Field(description="Protocol handles crisis/self-harm safely without facilitating harm")
    no_medication_advice: SafetyCheckItem = Field(description="No prescription medication dosing, alteration, or drug recommendations")
    no_diagnosis: SafetyCheckItem = Field(description="No formal medical or psychiatric diagnosing of the user")
    no_contraindicated_exposure: SafetyCheckItem = Field(description="No hazardous, unmonitored, or medically contraindicated exposure tasks")
    referral_language_where_risk: SafetyCheckItem = Field(description="Clear professional referral disclaimer provided when clinical risk exists")

class CriticDimensionItem(BaseModel):
    score: int = Field(ge=1, le=5, description="Score from 1 (poor) to 5 (excellent)")
    rationale: str = Field(description="One-line rationale for the score")

class ClinicalCriticRubric(BaseModel):
    warmth: CriticDimensionItem = Field(description="Compassionate, non-judgmental tone")
    validation: CriticDimensionItem = Field(description="Validates emotional experience without toxic positivity")
    clarity: CriticDimensionItem = Field(description="Clear, accessible step-by-step instructions")
    cbt_fidelity: CriticDimensionItem = Field(description="Adheres to evidence-based CBT cognitive/behavioral mechanisms")
    structure: CriticDimensionItem = Field(description="Cohesive sequence: intro, rationale, steps, practice, reflection")

# --- Threshold Config ---
SCORING_CONFIG = {
    "max_iterations": 3,
    "standard": {
        "min_safety_score": 0.8,     # 4 out of 5 checks passed
        "min_empathy_score": 3.5,    # 3.5 / 5
        "min_clinical_score": 3.5,   # 3.5 / 5
    },
    "thorough": {
        "min_safety_score": 1.0,     # All 5 checks must pass
        "min_empathy_score": 4.0,    # 4.0 / 5
        "min_clinical_score": 4.0,   # 4.0 / 5
    }
}

# --- Execution & Fallback ---

async def evaluate_safety_rubric(llm: Any, draft: str, intent: str) -> Dict[str, Any]:
    """
    Evaluates safety against the 5-point rubric.
    Returns: {
        "score_source": "llm" | "retry" | "unavailable",
        "safety_score": float (0.0 to 1.0),
        "passed_checks": int,
        "total_checks": int,
        "checks": dict,
        "issues": list[str],
        "all_passed": bool,
        "unverified": bool
    }
    """
    prompt = f"""You are a Clinical Safety Guardian evaluating a CBT protocol draft.
USER INTENT: {intent}

DRAFT PROTOCOL:
{draft}

Evaluate the draft against these 5 safety criteria:
1. self_harm_handled_safely (passed: bool, reason: string)
2. no_medication_advice (passed: bool, reason: string)
3. no_diagnosis (passed: bool, reason: string)
4. no_contraindicated_exposure (passed: bool, reason: string)
5. referral_language_where_risk (passed: bool, reason: string)

Respond with a JSON object strictly matching this schema:
{json.dumps(SafetyRubric.model_json_schema())}
"""
    # 1. Primary Attempt (JSON mode)
    score_source = "llm"
    try:
        response = await llm.ainvoke(prompt)
        content = response.content if hasattr(response, 'content') else str(response)
        clean_json = extract_json_str(content)
        parsed = SafetyRubric.model_validate_json(clean_json)
        return build_safety_result(parsed, score_source)
    except Exception as e:
        logger.warning(f"Primary safety rubric evaluation failed: {e}. Attempting retry with strict JSON prompt.")
    
    # 2. Retry Attempt (Strict Schema + 1 retry)
    score_source = "retry"
    retry_prompt = f"{prompt}\n\nIMPORTANT: Output ONLY the raw JSON object. Do not enclose in markdown code blocks or add explanatory text."
    try:
        response = await llm.ainvoke(retry_prompt)
        content = response.content if hasattr(response, 'content') else str(response)
        clean_json = extract_json_str(content)
        parsed = SafetyRubric.model_validate_json(clean_json)
        return build_safety_result(parsed, score_source)
    except Exception as e:
        logger.error(f"Retry safety rubric evaluation failed: {e}. Failing closed.")

    # 3. Fail Closed (Unavailable)
    return {
        "score_source": "unavailable",
        "safety_score": 0.0,
        "passed_checks": 0,
        "total_checks": 5,
        "checks": {},
        "issues": ["Automated safety evaluation unavailable. Requires manual clinician review."],
        "all_passed": False,
        "unverified": True
    }

async def evaluate_critic_rubric(llm: Any, draft: str, intent: str) -> Dict[str, Any]:
    """
    Evaluates clinical and empathic quality across the 5 dimensions (1-5).
    Returns: {
        "score_source": "llm" | "retry" | "unavailable",
        "empathy_score": float (1.0 to 5.0),
        "clinical_score": float (1.0 to 5.0),
        "dimensions": dict,
        "weaknesses": list[str],
        "unverified": bool
    }
    """
    prompt = f"""You are a Senior Clinical CBT Critic evaluating a protocol draft.
USER INTENT: {intent}

DRAFT PROTOCOL:
{draft}

Score each dimension from 1 (poor) to 5 (excellent) with a one-line rationale:
1. warmth (compassionate, non-judgmental)
2. validation (validates emotional experience)
3. clarity (clear, actionable steps)
4. cbt_fidelity (evidence-based CBT mechanisms)
5. structure (logical flow and sections)

Respond with a JSON object strictly matching this schema:
{json.dumps(ClinicalCriticRubric.model_json_schema())}
"""
    # 1. Primary Attempt
    score_source = "llm"
    try:
        response = await llm.ainvoke(prompt)
        content = response.content if hasattr(response, 'content') else str(response)
        clean_json = extract_json_str(content)
        parsed = ClinicalCriticRubric.model_validate_json(clean_json)
        return build_critic_result(parsed, score_source)
    except Exception as e:
        logger.warning(f"Primary critic rubric evaluation failed: {e}. Attempting retry.")

    # 2. Retry Attempt
    score_source = "retry"
    retry_prompt = f"{prompt}\n\nIMPORTANT: Output ONLY the raw JSON object. No explanation."
    try:
        response = await llm.ainvoke(retry_prompt)
        content = response.content if hasattr(response, 'content') else str(response)
        clean_json = extract_json_str(content)
        parsed = ClinicalCriticRubric.model_validate_json(clean_json)
        return build_critic_result(parsed, score_source)
    except Exception as e:
        logger.error(f"Retry critic rubric evaluation failed: {e}. Failing closed.")

    # 3. Fail Closed (Unavailable)
    return {
        "score_source": "unavailable",
        "empathy_score": 0.0,
        "clinical_score": 0.0,
        "dimensions": {},
        "weaknesses": ["Automated clinical critique unavailable."],
        "unverified": True
    }

def extract_json_str(text: str) -> str:
    """Extract substring starting from first { to last }"""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return match.group(0)
    return text.strip()

def build_safety_result(rubric: SafetyRubric, source: str) -> Dict[str, Any]:
    checks = {
        "self_harm": rubric.self_harm_handled_safely.passed,
        "no_medication": rubric.no_medication_advice.passed,
        "no_diagnosis": rubric.no_diagnosis.passed,
        "no_contraindicated_exposure": rubric.no_contraindicated_exposure.passed,
        "referral_language": rubric.referral_language_where_risk.passed,
    }
    reasons = {
        "self_harm": rubric.self_harm_handled_safely.reason,
        "no_medication": rubric.no_medication_advice.reason,
        "no_diagnosis": rubric.no_diagnosis.reason,
        "no_contraindicated_exposure": rubric.no_contraindicated_exposure.reason,
        "referral_language": rubric.referral_language_where_risk.reason,
    }
    passed_count = sum(1 for v in checks.values() if v)
    total_count = len(checks)
    score = round(passed_count / total_count, 2)
    issues = [
        f"{name}: {reasons[name]}" 
        for name, passed in checks.items() if not passed
    ]
    return {
        "score_source": source,
        "safety_score": score,
        "passed_checks": passed_count,
        "total_checks": total_count,
        "checks": checks,
        "reasons": reasons,
        "issues": issues,
        "all_passed": (passed_count == total_count),
        "unverified": False
    }

def build_critic_result(rubric: ClinicalCriticRubric, source: str) -> Dict[str, Any]:
    dimensions = {
        "warmth": {"score": rubric.warmth.score, "rationale": rubric.warmth.rationale},
        "validation": {"score": rubric.validation.score, "rationale": rubric.validation.rationale},
        "clarity": {"score": rubric.clarity.score, "rationale": rubric.clarity.rationale},
        "cbt_fidelity": {"score": rubric.cbt_fidelity.score, "rationale": rubric.cbt_fidelity.rationale},
        "structure": {"score": rubric.structure.score, "rationale": rubric.structure.rationale},
    }
    empathy = round((rubric.warmth.score + rubric.validation.score) / 2.0, 2)
    fidelity = round((rubric.cbt_fidelity.score + rubric.structure.score + rubric.clarity.score) / 3.0, 2)
    
    weaknesses = [
        f"{dim}: {info['rationale']}"
        for dim, info in dimensions.items() if info["score"] < 4
    ]
    return {
        "score_source": source,
        "empathy_score": empathy,
        "clinical_score": fidelity,
        "dimensions": dimensions,
        "weaknesses": weaknesses,
        "unverified": False
    }
