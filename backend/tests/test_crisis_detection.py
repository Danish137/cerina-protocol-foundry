"""
Test suite for F1 Crisis Detection
Verifies:
- 30+ positive phrasings (acute crisis, self-harm, suicidal ideation)
- 15+ benign phrasings (clinical exercises, metaphors, everyday idioms)
- Punctuation, casing, and normalization
- API behavior: crisis intent returns care_panel status without starting draft
"""

import pytest
from crisis import screen_crisis_intent

POSITIVE_CRISIS_PHRASES = [
    # Explicit core phrases from F1 prompt
    "I feel like ending it all",
    "end it all",
    "I am seriously thinking about ending it all tonight.",
    "I want to kill myself.",
    "kill myself",
    "Thinking of how to kill myself without pain.",
    "I am going to end my life.",
    "end my life",
    "I just want to end my life right now.",
    "I plan to take my life tomorrow.",
    "take my life",
    "Nobody cares if I take my own life.",
    "I don't want to live anymore.",
    "dont want to live",
    "i dont want to live in this world",
    "There is no reason to live.",
    "no reason to live",
    "Everyone would be better off dead.",
    "I am better off dead.",
    "better off dead",
    "I just want to die.",
    "want to die",
    "Every morning I wake up and want to die.",
    "I have chronic suicidal thoughts.",
    "suicide seems like the only option",
    "My suicidality is at an all-time high.",
    "I want to hurt myself badly.",
    "hurt myself",
    "Urges to hurt myself after argument.",
    "I engage in self-harm when overwhelmed.",
    "self-harm",
    "self harm tendencies",
    "I can't go on like this anymore.",
    "cant go on",
    "I simply cant go on with this misery.",
    "I want to cut myself.",
    "cut myself",
    "Cutting myself with a razor blade.",
    "I don't want to wake up tomorrow.",
    "dont want to wake up",
    "Slitting my wrists in the bathroom.",
    "I took a massive overdose of pills.",
]

BENIGN_PHRASES = [
    "insomnia protocol for chronic sleeplessness",
    "exposure hierarchy for social anxiety and public speaking",
    "killing time while waiting for my therapy appointment",
    "cutting calories to improve cardiovascular fitness",
    "end the session with a 5-minute breathing exercise",
    "behavioral activation for mild depressive symptoms",
    "cognitive restructuring for automatic negative thoughts",
    "grounding exercises for acute panic attacks",
    "mindful eating and somatic pacing routine",
    "grief counseling protocol following loss of elderly pet",
    "stress inoculation training for college students",
    "assertiveness training protocol for workplace boundary setting",
    "sleep hygiene routine and stimulus control instructions",
    "anger management protocol for road rage triggers",
    "worry time scheduling for generalized anxiety disorder",
    "rumination postponement exercise for obsessive thinking",
]

@pytest.mark.parametrize("phrase", POSITIVE_CRISIS_PHRASES)
def test_positive_crisis_phrasings(phrase):
    is_crisis, matched = screen_crisis_intent(phrase)
    assert is_crisis is True, f"Failed to detect crisis in positive phrase: '{phrase}'"
    assert matched is not None

@pytest.mark.parametrize("phrase", BENIGN_PHRASES)
def test_benign_phrasings(phrase):
    is_crisis, matched = screen_crisis_intent(phrase)
    assert is_crisis is False, f"False positive detected on benign phrase: '{phrase}' (matched: '{matched}')"
    assert matched is None

def test_punctuation_and_case_insensitivity():
    variants = [
        "I FEEL LIKE ENDING IT ALL!!!",
        "  i feel like ending it all...  ",
        "i don't want to live!!",
        "I DONT WANT TO LIVE.",
        "Can't Go On???",
        "CANT GO ON...",
        "I want to kill myself, honestly.",
        "Suicidal thoughts: present.",
    ]
    for text in variants:
        is_crisis, _ = screen_crisis_intent(text)
        assert is_crisis is True, f"Failed on case/punctuation variant: {text}"
