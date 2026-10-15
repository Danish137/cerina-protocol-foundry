"""
Local Pre-Screen Crisis Classifier (A10)
Additive check performed before starting any workflow generation.
Screens user intent using deterministic keyword and regex heuristics.
"""

import re
import json
import os
from typing import Dict, Any, Tuple, Optional

# Crisis patterns specifically matching suicidal ideation, intent, or self-harm
# Covers: end it all, ending it all, kill myself, end my life, take my life,
# don't want to live, no reason to live, better off dead, want to die,
# suicid*, hurt myself, self-harm, can't go on, cut myself, and common variants.
CRISIS_PATTERNS = [
    r"\bsuicid", # suicidal, suicide, suicidality
    r"\b(kill|killing)\s+(my|one)self\b",
    r"\b(end|ending)\s+it\s+all\b",
    r"\b(end|ending)\s+my\s+life\b",
    r"\b(take|taking)\s+my\s+(own\s+)?life\b",
    r"\b(want|wants|wishing|wish)\s+to\s+die\b",
    r"\bwish\s+(i\s+was|i\s+were)\s+dead\b",
    r"\bbetter\s+off\s+dead\b",
    r"\bno\s+reason\s+to\s+live\b",
    r"\b(don'?t|dont)\s+want\s+to\s+live\b",
    r"\b(don'?t|dont)\s+want\s+to\s+wake\s+up\b",
    r"\b(can'?t|cant)\s+go\s+on\b",
    r"\b(can'?t|cant)\s+take\s+this\s+pain\b",
    r"\bself[\s\-]harm",
    r"\b(hurt|hurting)\s+myself\b",
    r"\b(cut|cutting)\s+myself\b",
    r"\b(hang|hanging)\s+myself\b",
    r"\b(shoot|shooting)\s+myself\b",
    r"\b(overdose|overdosing)\b",
    r"\b(slit|slitting)\s+my\s+wrists?\b",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CRISIS_PATTERNS]

def normalize_text_for_screening(text: str) -> str:
    """Normalize apostrophes, smart quotes, and punctuation for reliable regex matching"""
    if not text:
        return ""
    # Standardize quotes and apostrophes
    t = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    # Collapse multiple whitespaces
    t = re.sub(r"\s+", " ", t).strip()
    return t

def screen_crisis_intent(text: str) -> Tuple[bool, Optional[str]]:
    """
    Screens input text for active self-harm or suicidal intent.
    Returns: (is_crisis, matched_pattern_text)
    
    Classifier limits:
    - This is a localized, regex-based heuristic intended to catch acute crisis phrases.
    - It does NOT replace professional clinical triage or ML-based semantic risk scoring.
    - Clinical users may bypass using the clinician verification flag.
    """
    if not text:
        return False, None
        
    normalized = normalize_text_for_screening(text)
    
    for pattern in COMPILED_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return True, match.group(0)
            
    return False, None

def get_crisis_resources(region_code: str = "US") -> Dict[str, Any]:
    """Load crisis resources from configuration for a specific region"""
    config_path = os.path.join(os.path.dirname(__file__), "config", "crisis_resources.json")
    if not os.path.exists(config_path):
        return {
            "primary": {"name": "Find A Helpline", "website": "https://findahelpline.com"},
            "fallback": {"website": "https://findahelpline.com"}
        }
        
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        region_code = region_code.upper()
        region_info = data.get("regions", {}).get(region_code)
        if not region_info:
            region_info = data.get("regions", {}).get("US", {})
            
        return {
            "region": region_info,
            "fallback": data.get("fallback", {}),
            "all_regions": data.get("regions", {})
        }
    except Exception:
        return {"fallback": {"website": "https://findahelpline.com"}}
