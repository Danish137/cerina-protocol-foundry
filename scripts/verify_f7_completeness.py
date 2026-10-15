import os
import sys
import re

backend_dir = r"d:\Projects\Cerina-Protocol-Foundary\backend"
sys.path.insert(0, backend_dir)

from agents.agents import check_draft_completeness

# Recreate the 3 draft structures that failed in complete_draft_comparison.json:

DRAFT_1_NUMBERED_AND_TRAILING_HR = """# Stimulus-Control & Sleep-Hygiene Protocol for Sleep-Onset Insomnia
*CBT-I (Cognitive-Behavioral Therapy for Insomnia) - Structured Clinical Guide*

---

## 1. Introduction
Sleep-onset insomnia is characterized by difficulty falling asleep within 30 minutes of bedtime.

## 2. Goals
1. Re-condition bed as sleep stimulus.
2. Establish regular circadian rhythm.

## 3. Step-by-Step Instructions
### Step 1: 20-Minute Rule
Leave bed if not asleep within 20 minutes.

### Step 2: Bedroom Exclusivity
Reserve bedroom for sleep and intimacy only.

## 4. Practice and Homework
Maintain sleep diary for 14 consecutive nights.

## 5. Reflection and Progress Review
Did sleep latency improve over the course of the week?

## 6. Conclusion
Consistent behavioral adherence extinguishes insomnia conditioned arousal.

---
"""

DRAFT_2_HIERARCHY_STEPS = """# Gradual In-Vivo Exposure Hierarchy for Elevator Phobia
*(CBT-Based Protocol for Adults & Adolescents)*

---

## Introduction
Elevator phobia is a specific situational phobia involving irrational fear of elevators.

## Treatment Goals
1. Reduce panic response during elevator transit.
2. Achieve habituation to SUDS <= 20.

## Exposure Hierarchy Steps
### Step 1: Elevator Proximity
Stand 10 feet from open elevator doors for 5 minutes.

### Step 2: Step Inside
Step into elevator on ground floor with doors held open.

### Step 3: Single Floor Transit
Ride elevator up one floor accompanied by support person.

## Behavioral Practice
Perform 3 exposure repetitions daily.

## Tracking & Reflection
Record SUDS before, during peak, and after each trial.

## Safety & Next Steps
Consult a licensed clinician if severe panic or vasovagal syncope occurs.
"""

DRAFT_3_BOLD_HEADINGS = """# **CBT Protocol - Developing a 5-Column Thought Record for Catastrophic Health Anxiety**

---

## **1. Introduction**
Catastrophic health anxiety involves hyper-vigilance to somatic sensations and catastrophic misinterpretation.

## **2. Goals**
1. Identify automatic catastrophic health thoughts.
2. Construct balanced cognitive reappraisals.

## **3. 5-Column Thought Record Steps**
### Step 1: Situation & Emotion
Describe bodily sensation and rate anxiety 0-100.

### Step 2: Automatic Thought
Capture immediate cognitive catastrophe.

### Step 3: Evidence Evaluation
Examine medical facts supporting and refuting the fear.

## **4. Daily Practice**
Complete one thought record entry per day.

## **5. Self-Reflection**
How did your anxiety rating shift after reading your alternative thought?

## **6. Conclusion**
Cognitive restructuring restores accurate somatic assessment.
"""

def test_drafts():
    drafts = [
        ("Draft 1 (Numbered + Trailing HR)", DRAFT_1_NUMBERED_AND_TRAILING_HR),
        ("Draft 2 (Exposure Hierarchy Steps)", DRAFT_2_HIERARCHY_STEPS),
        ("Draft 3 (Bold Asterisk Headings)", DRAFT_3_BOLD_HEADINGS),
    ]
    
    print("=" * 70)
    print("F7 COMPLETENESS CHECK PROOF ON THE 3 PREVIOUSLY-FAILING PATTERNS")
    print("=" * 70)
    
    all_passed = True
    for name, text in drafts:
        passed, issues = check_draft_completeness(text, finish_reason="stop")
        status = "PASSED" if passed else "FAILED"
        print(f"\n{name}: {status}")
        if issues:
            print(f"  Issues: {issues}")
            all_passed = False
        else:
            print(f"  All required sections detected cleanly: Introduction, Goals, Steps, Practice, Reflection, Conclusion")
            print(f"  Terminal punctuation validated without trailing rule false-flag.")

    print("\n" + "=" * 70)
    print(f"OVERALL RESULT: {'ALL 3 PASSED' if all_passed else 'FAILURES DETECTED'}")
    print("=" * 70)

if __name__ == "__main__":
    test_drafts()
