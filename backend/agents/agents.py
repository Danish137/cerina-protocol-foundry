"""
Individual Agent Implementations (A6, A7, A9)
- DrafterAgent with explicit markdown template and revision_summary
- SafetyGuardianAgent with 5-point fail-closed safety rubric
- ClinicalCriticAgent with 5-dimension fail-closed clinical rubric
- SupervisorAgent with configurable standard/thorough loop policies and FORCE_REVISION
"""

import os
import json
import time
import logging
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from agents.state import ProtocolState, add_agent_note, add_draft_version
from utils import log_agent_activity
from rubrics import evaluate_safety_rubric, evaluate_critic_rubric, SCORING_CONFIG
from security import record_llm_call

load_dotenv()
logger = logging.getLogger("cerina.agents")

def get_llm(role: str = "general"):
    """Get the LLM instance supporting pinned writer/judge models or general fallback"""
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not found in environment.")
    
    api_key = api_key.strip(' "\'')
    base_url = os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")
    
    if role == "writer":
        model = os.getenv("OPENAI_WRITER_MODEL") or os.getenv("OPENAI_MODEL", "openrouter/free")
    elif role == "judge":
        model = os.getenv("OPENAI_JUDGE_MODEL") or os.getenv("OPENAI_MODEL", "openrouter/free")
    else:
        model = os.getenv("OPENAI_MODEL", "openrouter/free")
    
    return ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model,
        temperature=0.7 if role == "writer" else 0.2
    )

class DrafterAgent:
    """Creates structured CBT exercise drafts using an explicit markdown template (A9)"""
    
    def __init__(self, llm: Optional[Any] = None):
        self.llm = llm
        self.name = "Drafter"
    
    async def draft(self, state: ProtocolState, stream_callback: Optional[Any] = None) -> Dict[str, Any]:
        from llm_client import llm_client
        intent = state["user_intent"]
        iteration = state.get("iteration_count", 0)
        review_depth = state.get("review_depth", "standard")
        
        # Open concerns from previous agent critiques (A7)
        recent_notes = [n for n in state.get("agent_notes", []) if n.get("target_agent") == "Drafter"]
        feedback_context = "\n".join([f"- [{n.get('agent_name')}]: {n.get('note')}" for n in recent_notes[-5:]])
        
        system_text = """You are a clinical psychologist specializing in Cognitive Behavioral Therapy (CBT).
Your task is to create structured, empathetic, and evidence-based CBT exercises.

MANDATORY MARKDOWN STRUCTURE (You MUST follow this exact hierarchy):
# [Descriptive Protocol Title]

## Introduction
[Compassionate explanation of the clinical objective, mechanism of change, and who this is for.]

## Goals
[1-3 measurable behavioral or cognitive goals.]

## Steps
### Step 1: [Actionable Step Title]
[Detailed instructions, examples, and rationale]

### Step 2: [Actionable Step Title]
[Detailed instructions]

### Step 3: [Actionable Step Title]
[Detailed instructions]

## Practice
[Clear homework, daily practice routine, or exposure exercise.]

## Reflection
[Guided debrief questions for the user to reflect on their thoughts and physical sensations.]

## Conclusion
[Encouraging wrap-up statement and safety disclaimer recommending professional consultation if distress worsens.]

Tone: Warm, non-judgmental, clinically grounded.
Safety: Never prescribe medications or advise altering dosages.

CRITICAL CONTENT RESTRICTIONS (STRICTLY ENFORCED):
- No named apps or commercial products: Do NOT recommend or mention specific commercial apps, digital tools, brands, or platforms (e.g. do NOT name 'Sleep Diary Pro', 'Calm', 'Headspace', 'Moodkit'). Use generic clinical phrasing (e.g. 'a daily sleep log', 'a thought record journal').
- No academic citations or authors: Do NOT include academic citations, author names, publication years, or literature references (e.g. do NOT write '(Beck et al., 1979)', 'Linehan (1993)'). Deliver clinical guidance directly without academic bibliography citations."""

        existing_draft = (state.get("current_draft") or "").strip()
        if iteration > 0 and existing_draft:
            user_text = f"""You are revising an existing CBT protocol based on reviewer and clinician feedback.

PRESERVATION & TARGETED REVISION RULES:
1. Preserve the structure, existing headings, and all untouched sections of the draft.
2. Modify ONLY the specific sentences, sections, or phrasing necessary to address the requested feedback.
3. Do NOT rewrite the entire protocol. Keep untouched instructions, steps, and paragraphs intact.

FEEDBACK TO ADDRESS:
{feedback_context or 'Please address clinical review recommendations.'}

EXISTING PROTOCOL DRAFT:
{existing_draft}

Produce the updated protocol with targeted improvements:"""
        else:
            user_text = f"Create a CBT protocol for: {intent}\n\nFeedback to address from reviewers:\n{feedback_context or 'No previous feedback. Create initial draft.'}"

        # 1. Backwards compatibility for unit test mock LLMs
        if self.llm is not None and hasattr(self.llm, "ainvoke"):
            t0 = time.time()
            prompt = ChatPromptTemplate.from_messages([
                ("system", system_text),
                ("human", user_text)
            ])
            messages = prompt.format_messages()
            response = await self.llm.ainvoke(messages)
            latency_ms = (time.time() - t0) * 1000
            draft_content = response.content if hasattr(response, 'content') else str(response)
            serving_model = getattr(self.llm, "model_name", "test_writer")
            serving_provider = "test_provider"
            finish_reason = "stop"
        else:
            # 2. Production streaming draft via UnifiedLLMClient (raised max_tokens to 3500 for complete drafts)
            messages_list = [
                {"role": "system", "content": system_text},
                {"role": "user", "content": user_text}
            ]
            llm_res = await llm_client.execute_with_failover(
                role="writer",
                messages=messages_list,
                temperature=0.7,
                max_tokens=3500,
                stream_callback=stream_callback
            )
            draft_content = llm_res.content
            latency_ms = llm_res.latency_ms
            serving_model = llm_res.model
            serving_provider = llm_res.provider
            finish_reason = getattr(llm_res, "finish_reason", "stop")

        # Record LLM call for capacity guard (A5)
        record_llm_call(
            session_id=state.get("session_id"),
            model=serving_model,
            call_type="draft",
            latency_ms=latency_ms
        )
        
        # Revision summary if revising (A7)
        revision_summary = []
        if iteration > 0 and recent_notes:
            for note in recent_notes[-3:]:
                revision_summary.append({
                    "responding_to": note.get("note", "")[:60],
                    "change": "Targeted clinical revision addressing specific reviewer feedback."
                })

        target_version = state.get("current_version", 0) + 1
        state = add_agent_note(
            state,
            self.name,
            f"Created draft version {target_version}",
            priority="info"
        )
        
        return {
            "current_draft": draft_content,
            "active_agent": self.name,
            "status": "drafting",
            "revision_summary": revision_summary,
            "drafter_provider": serving_provider,
            "drafter_model": serving_model,
            "latency_ms": latency_ms,
            "finish_reason": finish_reason
        }

class SafetyGuardianAgent:
    """Validates content using 5-point fail-closed rubric (A6)"""
    
    def __init__(self, llm: Optional[Any] = None):
        self.llm = llm
        self.name = "SafetyGuardian"
    
    async def review(self, state: ProtocolState) -> Dict[str, Any]:
        draft = state.get("current_draft")
        if not draft:
            return {"status": "no_draft"}
        
        intent = state.get("user_intent", "")
        drafter_provider = state.get("drafter_provider", "groq")
        t0 = time.time()
        
        # Evaluate using rubric with zero same-family self-grading
        eval_result = await evaluate_safety_rubric(
            llm=self.llm,
            draft=draft,
            intent=intent,
            drafter_provider=drafter_provider
        )
        latency_ms = (time.time() - t0) * 1000
        serving_model = eval_result.get("model", getattr(self.llm, "model_name", "judge_model"))
        serving_provider = eval_result.get("provider", "judge_provider")
        
        record_llm_call(
            session_id=state.get("session_id"),
            model=serving_model,
            call_type="safety",
            latency_ms=latency_ms
        )
        
        safety_score = eval_result["safety_score"]
        score_source = eval_result["score_source"]
        all_passed = eval_result["all_passed"]
        issues = eval_result.get("issues", [])
        
        # Add blackboard notes
        if not all_passed or safety_score < 0.8:
            for issue in issues[:3]:
                state = add_agent_note(
                    state,
                    self.name,
                    f"SAFETY ISSUE: {issue}",
                    target_agent="Drafter",
                    priority="critical"
                )
        else:
            state = add_agent_note(
                state,
                self.name,
                f"Safety check passed ({eval_result['passed_checks']}/5 checks, score {safety_score:.2f})",
                priority="info"
            )
            
        return {
            "safety_checks": eval_result.get("checks", {}),
            "safety_reasons": eval_result.get("reasons", {}),
            "safety_score": safety_score,
            "score_source": score_source,
            "model": serving_model,
            "provider": serving_provider,
            "unverified": eval_result.get("unverified", False),
            "status": "reviewed"
        }

class ClinicalCriticAgent:
    """Evaluates clinical appropriateness, tone, and empathy using 5-dimension rubric (A6)"""
    
    def __init__(self, llm: Optional[Any] = None):
        self.llm = llm
        self.name = "ClinicalCritic"
    
    async def critique(self, state: ProtocolState) -> Dict[str, Any]:
        draft = state.get("current_draft")
        if not draft:
            return {"status": "no_draft"}
            
        intent = state.get("user_intent", "")
        drafter_provider = state.get("drafter_provider", "groq")
        t0 = time.time()
        
        eval_result = await evaluate_critic_rubric(
            llm=self.llm,
            draft=draft,
            intent=intent,
            drafter_provider=drafter_provider
        )
        latency_ms = (time.time() - t0) * 1000
        serving_model = eval_result.get("model", getattr(self.llm, "model_name", "judge_model"))
        serving_provider = eval_result.get("provider", "judge_provider")
        
        record_llm_call(
            session_id=state.get("session_id"),
            model=serving_model,
            call_type="critic",
            latency_ms=latency_ms
        )
        
        empathy_score = eval_result["empathy_score"]
        clinical_score = eval_result["clinical_score"]
        score_source = eval_result["score_source"]
        weaknesses = eval_result.get("weaknesses", [])
        
        if weaknesses:
            for w in weaknesses[:3]:
                state = add_agent_note(
                    state,
                    self.name,
                    f"IMPROVEMENT NEEDED: {w}",
                    target_agent="Drafter",
                    priority="warning"
                )
        else:
            state = add_agent_note(
                state,
                self.name,
                f"Clinical critique passed. Empathy: {empathy_score:.1f}/5, Fidelity: {clinical_score:.1f}/5",
                priority="info"
            )
            
        return {
            "empathy_score": empathy_score,
            "clinical_score": clinical_score,
            "dimensions": eval_result.get("dimensions", {}),
            "score_source": score_source,
            "model": serving_model,
            "provider": serving_provider,
            "unverified": eval_result.get("unverified", False),
            "status": "critiqued"
        }

def check_draft_completeness(draft: str, finish_reason: Optional[str] = None) -> Tuple[bool, List[str]]:
    """
    Deterministic completeness check (G2):
    - All required sections present (accepting valid clinical variations)
    - Proper ending (ends with terminal punctuation, not truncated)
    - finish_reason is not 'length'
    """
    reasons = []
    if finish_reason in ["length", "max_tokens"]:
        reasons.append("Draft was truncated by token limit (finish_reason='length')")

    # Required section categories with acceptable clinical variants (case-insensitive)
    required_categories = {
        "Introduction": ["## introduction", "## background", "## overview", "## clinical background"],
        "Goals": ["## goals", "## objectives", "## treatment goals", "## protocol goals"],
        "Steps": [
            "## steps", "## step-by-step instructions", "## step-by-step", "## protocol steps",
            "## action steps", "## instructions", "## core steps", "## step-by-step guide"
        ],
        "Practice": ["## practice", "## homework", "## daily practice", "## home practice", "## practice exercises"],
        "Reflection": ["## reflection", "## debrief", "## self-reflection", "## review & reflection", "## tracking"],
        "Conclusion": ["## conclusion", "## next steps", "## summary", "## closing", "## safety & next steps", "## final recommendations"]
    }

    draft_lower = draft.lower()
    # Normalize numbered headings like "## 1. Introduction" -> "## introduction"
    import re
    norm_draft = re.sub(r"##\s*(?:[0-9]+[\.\)]|section\s*[0-9]+:?)\s*", "## ", draft_lower)

    missing = []
    for cat_name, variants in required_categories.items():
        if not any(v in norm_draft for v in variants):
            missing.append(cat_name)

    if missing:
        reasons.append(f"Missing required sections: {', '.join(missing)}")

    stripped = draft.strip()
    if len(stripped) < 200:
        reasons.append("Draft is too short (<200 characters)")
    elif stripped and stripped[-1] not in [".", "!", "?", '"', "'", "`", "]", "}", ")"]:
        reasons.append("Draft ends abruptly mid-sentence without terminal punctuation")

    return (len(reasons) == 0), reasons

class SupervisorAgent:
    """Autonomous orchestrator enforcing loop policies (A7)"""
    
    def __init__(self):
        self.name = "Supervisor"
    
    async def decide(self, state: ProtocolState) -> Dict[str, Any]:
        iteration = state.get("iteration_count", 0)
        max_iterations = SCORING_CONFIG["max_iterations"] # 3
        review_depth = state.get("review_depth", "standard") # standard | thorough
        thresholds = SCORING_CONFIG.get(review_depth, SCORING_CONFIG["standard"])
        
        safety_score = state.get("safety_score", 0.0)
        empathy_score = state.get("empathy_score", 0.0)
        clinical_score = state.get("clinical_score", 0.0)
        unverified = state.get("unverified", False)
        
        # Dev flag FORCE_REVISION
        force_revision = (os.getenv("FORCE_REVISION", "0") == "1") and (iteration == 0)
        
        # Deterministic Completeness Check (G2): An incomplete draft is never passed
        current_draft = state.get("current_draft") or ""
        finish_reason = state.get("finish_reason")
        is_complete, completeness_issues = check_draft_completeness(current_draft, finish_reason)
        if not is_complete and iteration < max_iterations:
            reason = f"Draft incomplete ({'; '.join(completeness_issues)}) -> routing back to Drafter for completion (revision {iteration + 1})"
            state = add_agent_note(state, self.name, reason, priority="warning")
            return {
                "next_agent": "Drafter",
                "status": "needs_revision",
                "halted": False,
                "reason": reason
            }

        # Check max iterations
        if iteration >= max_iterations:
            reason = f"Max iterations ({max_iterations}) reached. Halting for human sign-off."
            state = add_agent_note(state, self.name, reason, priority="warning")
            return {
                "next_agent": "HALT",
                "status": "awaiting_approval",
                "halted": True,
                "reason": reason
            }
            
        # Fail closed check
        if unverified:
            reason = "Automated checks unavailable. Routing to human with unverified status."
            state = add_agent_note(state, self.name, reason, priority="warning")
            return {
                "next_agent": "HALT",
                "status": "awaiting_approval",
                "halted": True,
                "reason": reason
            }
            
        # Check thresholds
        meets_safety = (safety_score >= thresholds["min_safety_score"])
        meets_empathy = (empathy_score >= thresholds["min_empathy_score"])
        meets_clinical = (clinical_score >= thresholds["min_clinical_score"])
        
        if force_revision:
            reason = "FORCE_REVISION enabled: routing back to Drafter for revision 1."
            state = add_agent_note(state, self.name, reason, priority="warning")
            return {
                "next_agent": "Drafter",
                "status": "needs_revision",
                "halted": False,
                "reason": reason
            }
            
        if meets_safety and meets_empathy and meets_clinical:
            checks_passed = sum(1 for v in state.get("safety_checks", {}).values() if v)
            checks_total = max(len(state.get("safety_checks", {})), 5)
            reason = f"Empathy {empathy_score:.1f}/5 \u2265 {thresholds['min_empathy_score']}, Fidelity {clinical_score:.1f}/5 \u2265 {thresholds['min_clinical_score']}, Safety {checks_passed}/{checks_total} \u2192 human review"
            state = add_agent_note(state, self.name, reason, priority="info")
            return {
                "next_agent": "HALT",
                "status": "awaiting_approval",
                "halted": True,
                "reason": reason
            }
            
        # Needs revision
        fail_reasons = []
        if not meets_safety:
            fail_reasons.append(f"Safety {safety_score:.2f} < {thresholds['min_safety_score']}")
        if not meets_empathy:
            fail_reasons.append(f"Empathy {empathy_score:.1f} < {thresholds['min_empathy_score']}")
        if not meets_clinical:
            fail_reasons.append(f"Clinical {clinical_score:.1f} < {thresholds['min_clinical_score']}")
            
        reason = f"{', '.join(fail_reasons)} -> back to Drafter (revision {iteration + 1})"
        state = add_agent_note(state, self.name, reason, priority="warning")
        return {
            "next_agent": "Drafter",
            "status": "needs_revision",
            "halted": False,
            "reason": reason
        }
