import os
import sys
import time
import json
import statistics
import asyncio

backend_dir = r"d:\Projects\Cerina-Protocol-Foundary\backend"
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"))

from llm_client import llm_client, GroqAdapter, GeminiAdapter, OpenRouterAdapter, MODEL_FAMILY

async def benchmark_routing_cells():
    print("=" * 70)
    print("F5 & F6 ROUTING & LATENCY BENCHMARK (N=3 PER CELL)")
    print("=" * 70)

    # 1. Routing plans
    writer_plan = llm_client.resolve_writer_plan()
    safety_plan = llm_client.resolve_judge_plan(role="safety", drafter_model="openai/gpt-oss-120b")
    critic_plan = llm_client.resolve_judge_plan(role="critic", drafter_model="openai/gpt-oss-120b")

    print("\n--- Routing Plans (Enforcing Zero Same-Family Self-Grading) ---")
    print(f"Writer Plan:  {' -> '.join([f'{p}:{m}' for p, m in writer_plan])}")
    print(f"Safety Plan:  {' -> '.join([f'{p}:{m}' for p, m in safety_plan])}")
    print(f"Critic Plan:  {' -> '.join([f'{p}:{m}' for p, m in critic_plan])}")

    # Check zero same-family for OpenAI drafter
    drafter_fam = "openai"
    for role, plan in [("Safety", safety_plan), ("Critic", critic_plan)]:
        for p, m in plan:
            fam = MODEL_FAMILY.get(m, "unknown")
            assert fam != drafter_fam, f"Violation in {role}: {m} ({fam}) matches drafter family {drafter_fam}!"
    print("\n[VERIFIED] Zero same-family self-grading: No OpenAI models in Safety or Critic plans.")

    # 2. Benchmark primary & secondary cells (N=3 each)
    cells_to_test = [
        ("Writer Primary", "groq", "openai/gpt-oss-120b", "writer"),
        ("Writer Fallback", "gemini", "gemini-3.5-flash-lite", "writer"),
        ("Safety Primary", "groq", "qwen/qwen3.8-27b", "safety"),
        ("Critic Primary", "gemini", "gemini-3.5-flash-lite", "critic")
    ]

    results = {}
    for label, prov, mod, role in cells_to_test:
        print(f"\nBenchmarking {label} [{prov}:{mod}] (N=3)...")
        adapter = llm_client._get_adapter(prov)
        latencies = []
        
        msgs = [
            {"role": "system", "content": "You are a clinical CBT evaluation assistant. Respond concisely."},
            {"role": "user", "content": "Evaluate whether sleep restriction therapy is indicated for sleep maintenance insomnia in 2 bullet points."}
        ]
        
        for run_idx in range(1, 4):
            t0 = time.perf_counter()
            try:
                res = await adapter.generate(
                    model=mod,
                    messages=msgs,
                    temperature=0.2,
                    max_tokens=400,
                    json_mode=False
                )
                dur = round(time.perf_counter() - t0, 3)
                latencies.append(dur)
                print(f"  Run {run_idx}: {dur}s (chars: {len(res.content)})")
            except Exception as e:
                print(f"  Run {run_idx} error: {e}")
            await asyncio.sleep(2.0)

        if latencies:
            latencies.sort()
            p50 = statistics.median(latencies)
            # Nearest-rank or 90th percentile
            p90 = latencies[-1] if len(latencies) < 10 else latencies[int(len(latencies)*0.9)]
            results[label] = {
                "provider": prov,
                "model": mod,
                "runs": latencies,
                "p50_s": round(p50, 3),
                "p90_s": round(p90, 3)
            }
            print(f"  => p50: {p50:.3f}s | p90: {p90:.3f}s")

    print("\n" + "=" * 70)
    print("SUMMARY OF BENCHMARK LATENCIES:")
    print("=" * 70)
    for lbl, r in results.items():
        print(f"{lbl:18} | {r['provider']}:{r['model']:28} | p50: {r['p50_s']:5.2f}s | p90: {r['p90_s']:5.2f}s | Runs: {r['runs']}")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(benchmark_routing_cells())
