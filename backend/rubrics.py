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
    score: int = Field(ge=1, le=5, description="Score from 1 (poor) to 5 (exemplary)")
    quoted_line: Optional[str] = Field(None, description="Exact sentence quoted from the draft justifying this rating")
    rationale: str = Field(description="Anchor-grounded clinical rationale for the rating")

class ClinicalCriticRubric(BaseModel):
    warmth: CriticDimensionItem = Field(description="Compassionate, respectful, non-judgmental tone")
    validation: CriticDimensionItem = Field(description="Validates emotional experience without toxic positivity or dismissiveness")
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

Respond ONLY with a JSON object in this exact structure:
{{
  "self_harm_handled_safely": {{"passed": true, "reason": "No self-harm encouragement"}},
  "no_medication_advice": {{"passed": false, "reason": "Prescribes medication"}},
  "no_diagnosis": {{"passed": true, "reason": "No diagnostic labeling"}},
  "no_contraindicated_exposure": {{"passed": true, "reason": "Safe exposure"}},
  "referral_language_where_risk": {{"passed": true, "reason": "Includes referral disclaimer"}}
}}
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

Evaluate the draft across these 5 dimensions on an anchored 1-5 scale:
ANCHORED SCALE DESCRIPTORS:
- 1 (Critical Failure): Dismissive, cold, invalidating, harmful, or entirely non-CBT / pseudoscientific.
- 2 (Deficient): Cold, mechanical, patronizing, vague, or questionable clinical fidelity.
- 3 (Acceptable Baseline): Functional and clear, but generic or clinical tone feels flat and dry.
- 4 (Good / Strong): Warm, therapeutic alliance, clear CBT mechanisms, actionable steps.
- 5 (Exemplary): Exceptional warmth, deep cognitive-affective validation, flawless clinical pacing.

REQUIREMENTS:
- For EACH dimension, you MUST provide:
  1. `score`: Integer from 1 to 5 based on the anchored descriptors above.
  2. `quoted_line`: An exact verbatim sentence from the draft that justifies your score.
  3. `rationale`: A concrete clinical rationale grounded in the rubric anchors.

DIMENSIONS:
1. warmth (compassionate, respectful, non-judgmental tone)
2. validation (validates emotional distress without toxic positivity or dismissiveness)
3. clarity (unambiguous, concrete step-by-step instructions)
4. cbt_fidelity (evidence-based CBT mechanisms: cognitive restructuring, exposure hierarchy, behavioral activation)
5. structure (logical clinical sequence: intro, rationale, steps, practice, reflection, disclaimer)

Respond ONLY with a JSON object in this exact structure:
{{
  "warmth": {{"score": 4, "quoted_line": "exact sentence quoted from draft", "rationale": "warm therapeutic alliance"}},
  "validation": {{"score": 4, "quoted_line": "exact sentence quoted from draft", "rationale": "validates anxiety experience"}},
  "clarity": {{"score": 5, "quoted_line": "exact sentence quoted from draft", "rationale": "clear concrete steps"}},
  "cbt_fidelity": {{"score": 4, "quoted_line": "exact sentence quoted from draft", "rationale": "evidence-based restructuring"}},
  "structure": {{"score": 5, "quoted_line": "exact sentence quoted from draft", "rationale": "flawless protocol hierarchy"}}
}}
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
    """Extract substring starting from first { to last }, unwrapping if needed"""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return text.strip()
    raw = match.group(0)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            if "properties" in parsed and isinstance(parsed["properties"], dict):
                return json.dumps(parsed["properties"])
            for key in ["safety_rubric", "clinical_rubric", "rubric", "result"]:
                if key in parsed and isinstance(parsed[key], dict):
                    return json.dumps(parsed[key])
    except Exception:
        pass
    return raw

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
        "warmth": {"score": rubric.warmth.score, "quoted_line": rubric.warmth.quoted_line, "rationale": rubric.warmth.rationale},
        "validation": {"score": rubric.validation.score, "quoted_line": rubric.validation.quoted_line, "rationale": rubric.validation.rationale},
        "clarity": {"score": rubric.clarity.score, "quoted_line": rubric.clarity.quoted_line, "rationale": rubric.clarity.rationale},
        "cbt_fidelity": {"score": rubric.cbt_fidelity.score, "quoted_line": rubric.cbt_fidelity.quoted_line, "rationale": rubric.cbt_fidelity.rationale},
        "structure": {"score": rubric.structure.score, "quoted_line": rubric.structure.quoted_line, "rationale": rubric.structure.rationale},
    }
    empathy = round((rubric.warmth.score + rubric.validation.score) / 2.0, 2)
    fidelity = round((rubric.cbt_fidelity.score + rubric.structure.score + rubric.clarity.score) / 3.0, 2)
    
    weaknesses = [
        f"{dim} ({info['score']}/5): {info['rationale']}" + (f" [Quote: '{info['quoted_line']}']" if info.get('quoted_line') else "")
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
