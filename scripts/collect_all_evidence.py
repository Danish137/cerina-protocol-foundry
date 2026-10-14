import os, sys, time, json, asyncio, statistics
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath(r"d:\Projects\Cerina-Protocol-Foundary\backend"))
from dotenv import load_dotenv
load_dotenv(r"d:\Projects\Cerina-Protocol-Foundary\backend\.env")

# Ensure MOCK_LLM is off for real evidence collection
os.environ["MOCK_LLM"] = "false"

from agents.agents import DrafterAgent, SafetyGuardianAgent, ClinicalCriticAgent, SupervisorAgent, check_draft_completeness
from agents.state import create_initial_state

INTENTS = [
    "Design a stimulus control and sleep hygiene routine for sleep-onset insomnia",
    "Create a gradual in vivo exposure hierarchy for elevator phobia",
    "Develop a 5-column thought record for catastrophic health anxiety",
    "Construct a behavioral activation schedule for unipolar depressive inertia",
    "Formulate a worry postponement and decision tree protocol for generalized anxiety",
    "Build a interoceptive exposure protocol for panic-related cardiac sensations",
    "Design an assertiveness and interpersonal effectiveness script for social anxiety",
    "Create an urge surfing protocol for compulsive skin picking",
    "Develop a cognitive restructuring exercise for impostor phenomenon in workplace",
    "Formulate a progressive muscle relaxation and somatic grounding guide for acute stress"
]

async def run_single_pipeline(intent: str, session_id: str, outage_setting: str = "") -> Dict[str, Any]:
    if outage_setting:
        os.environ["TEST_ALLOW_OUTAGE_SIMULATION"] = "true"
        os.environ["SIMULATE_OUTAGE_PROVIDER"] = outage_setting
    else:
        os.environ["TEST_ALLOW_OUTAGE_SIMULATION"] = "false"
        os.environ["SIMULATE_OUTAGE_PROVIDER"] = ""

    t_start = time.perf_counter()
    first_token_time = None
    first_token_recorded = False

    def on_token(t):
        nonlocal first_token_time, first_token_recorded
        if not first_token_recorded and t.strip():
            first_token_time = round(time.perf_counter() - t_start, 3)
            first_token_recorded = True

    state = create_initial_state(user_intent=intent, session_id=session_id)

    # 1. Drafter
    drafter = DrafterAgent()
    d_start = time.perf_counter()
    d_res = await drafter.draft(state, stream_callback=on_token)
    d_latency = round(time.perf_counter() - d_start, 3)
    state["current_draft"] = d_res.get("current_draft", "")
    state["drafter_model"] = d_res.get("drafter_model", "")
    state["drafter_provider"] = d_res.get("drafter_provider", "")

    # 2. Parallel Safety & Critic
    safety = SafetyGuardianAgent()
    critic = ClinicalCriticAgent()

    s_start = time.perf_counter()
    c_start = time.perf_counter()

    s_task = asyncio.create_task(safety.review(state))
    c_task = asyncio.create_task(critic.critique(state))

    s_res = await s_task
    s_latency = round(time.perf_counter() - s_start, 3)

    c_res = await c_task
    c_latency = round(time.perf_counter() - c_start, 3)

    state["safety_score"] = s_res.get("safety_score", 0.0)
    state["safety_checks"] = s_res.get("safety_checks", {})
    state["empathy_score"] = c_res.get("empathy_score", 0.0)
    state["clinical_score"] = c_res.get("clinical_score", 0.0)
    state["unverified"] = s_res.get("unverified", False) or c_res.get("unverified", False)

    # 3. Supervisor
    supervisor = SupervisorAgent()
    sup_start = time.perf_counter()
    sup_res = await supervisor.decide(state)
    sup_latency = round(time.perf_counter() - sup_start, 3)

    total_latency = round(time.perf_counter() - t_start, 3)
    is_complete, completeness_issues = check_draft_completeness(state["current_draft"])

    return {
        "session_id": session_id,
        "intent": intent,
        "first_token_time_s": first_token_time or d_latency,
        "stages": {
            "drafter_latency_s": d_latency,
            "safety_latency_s": s_latency,
            "critic_latency_s": c_latency,
            "supervisor_latency_s": sup_latency
        },
        "total_latency_s": total_latency,
        "models": {
            "writer": d_res.get("drafter_model", "unknown"),
            "safety": s_res.get("model", "unknown"),
            "critic": c_res.get("model", "unknown")
        },
        "providers": {
            "writer": d_res.get("drafter_provider", "unknown"),
            "safety": s_res.get("provider", "unknown"),
            "critic": c_res.get("provider", "unknown")
        },
        "scores": {
            "safety_score": state["safety_score"],
            "empathy_score": state["empathy_score"],
            "clinical_score": state["clinical_score"],
            "unverified": state["unverified"]
        },
        "route": sup_res.get("next_agent"),
        "route_status": sup_res.get("status"),
        "completeness_passed": is_complete,
        "completeness_issues": completeness_issues,
        "char_count": len(state["current_draft"])
    }

async def main():
    print("=== STARTING EVIDENCE COLLECTION ===")
    out_dir = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence"
    os.makedirs(out_dir, exist_ok=True)

    normal_runs = []
    print("\n--- 1. Executing 10 Normal Live Runs ---")
    for i, intent in enumerate(INTENTS, 1):
        sess_id = f"live_norm_run_{i:02d}_{int(time.time())}"
        print(f"Run {i}/10: '{intent[:45]}...'")
        res = await run_single_pipeline(intent, sess_id, outage_setting="")
        normal_runs.append(res)
        print(f"  TTFT={res['first_token_time_s']}s | Draft={res['stages']['drafter_latency_s']}s | Safety={res['stages']['safety_latency_s']}s | Critic={res['stages']['critic_latency_s']}s | Total={res['total_latency_s']}s")
        print(f"  Models: Writer={res['models']['writer']} | Safety={res['models']['safety']} | Critic={res['models']['critic']}")
        await asyncio.sleep(2.0) # Pacing between live calls

    # Outage Scenarios
    outage_scenarios = [
        ("groq_down", "groq", "Scenario 1: Groq Outage (Writer falls over to Gemini)"),
        ("gemini_down", "gemini", "Scenario 2: Gemini Outage (Judges fall over to Qwen/OpenRouter)"),
        ("flash_38_503", "gemini-3.8-flash", "Scenario 3: 3.8 Flash 503 (Safety on 3.1 FL, Critic on 3.5 FL unaffected)"),
        ("all_judges_down", "all_judges", "Scenario 4: All Judges Down (Fail-closed 'Not verified')")
    ]

    outage_results = {}
    for sc_key, sim_val, sc_name in outage_scenarios:
        print(f"\n--- {sc_name} (3 repeats) ---")
        runs = []
        for r_idx in range(1, 4):
            sess_id = f"outage_{sc_key}_r{r_idx}_{int(time.time())}"
            intent = INTENTS[r_idx - 1]
            res = await run_single_pipeline(intent, sess_id, outage_setting=sim_val)
            runs.append(res)
            print(f"  Repeat {r_idx}: Total={res['total_latency_s']}s | Route={res['route']} | Status={res['route_status']} | Unverified={res['scores']['unverified']}")
            print(f"    Serving: Writer={res['models']['writer']} ({res['providers']['writer']}) | Safety={res['models']['safety']} ({res['providers']['safety']}) | Critic={res['models']['critic']} ({res['providers']['critic']})")
            await asyncio.sleep(2.0)
        outage_results[sc_key] = runs

    # Compute Statistics from normal_runs only
    ttfts = [r["first_token_time_s"] for r in normal_runs]
    totals = [r["total_latency_s"] for r in normal_runs]
    draft_times = [r["stages"]["drafter_latency_s"] for r in normal_runs]
    safety_times = [r["stages"]["safety_latency_s"] for r in normal_runs]
    critic_times = [r["stages"]["critic_latency_s"] for r in normal_runs]

    def calc_stats(arr):
        s_arr = sorted(arr)
        return {
            "median": round(statistics.median(s_arr), 3),
            "p90": round(s_arr[int(len(s_arr) * 0.9) - 1], 3),
            "worst": round(max(s_arr), 3),
            "min": round(min(s_arr), 3)
        }

    summary_stats = {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "normal_runs_count": len(normal_runs),
        "first_token": calc_stats(ttfts),
        "total_latency": calc_stats(totals),
        "drafter_latency": calc_stats(draft_times),
        "safety_latency": calc_stats(safety_times),
        "critic_latency": calc_stats(critic_times)
    }

    evidence_data = {
        "metadata": {
            "generator": "scripts/collect_all_evidence.py",
            "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "note": "100% empirical live API calls; MOCK_LLM=false"
        },
        "summary_statistics": summary_stats,
        "normal_runs": normal_runs,
        "forced_outages": outage_results
    }

    out_file = os.path.join(out_dir, "runs.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(evidence_data, f, indent=2)

    print(f"\n[EVIDENCE] Saved runs.json to {out_file}")
    print("\nSUMMARY STATS:")
    print(json.dumps(summary_stats, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
