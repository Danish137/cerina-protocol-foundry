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
CRISIS_PATTERNS = [
    r"\b(suicid(e|al)|kill\s+(my|one)self|end\s+my\s+life|want\s+to\s+die|wish\s+I\s+were\s+dead)\b",
    r"\b(can'?t\s+take\s+this\s+pain\s+anymore.*want\s+everything\s+to\s+stop)\b",
    r"\b(hang(ing)?\s+myself|shoot\s+myself|overdos(e|ing)|slitt?ing\s+my\s+wrists)\b",
    r"\b(self[\s\-]harm|cutting\s+myself|hurting\s+myself)\b",
    r"\b(better\s+off\s+dead|no\s+reason\s+to\s+live|don'?t\s+want\s+to\s+wake\s+up)\b",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CRISIS_PATTERNS]

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
        
    for pattern in COMPILED_PATTERNS:
        match = pattern.search(text)
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
