import os
import sys
import asyncio
import time
import httpx
from playwright.async_api import async_playwright

backend_dir = r"d:\Projects\Cerina-Protocol-Foundary\backend"
evidence_dir = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence"
sys.path.insert(0, backend_dir)

async def test_outages():
    os.environ["TEST_ALLOW_OUTAGE_SIMULATION"] = "true"
    
    print("=" * 70)
    print("F2 AUTOMATED OUTAGE SIMULATION & EVIDENCE CAPTURE")
    print("=" * 70)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        # -------------------------------------------------------------
        # 1. Groq Outage Simulation: Writer fails over to Gemini/OpenRouter
        # -------------------------------------------------------------
        print("\n--- Test 1: Simulating Groq Outage (Writer Failover) ---")
        os.environ["SIMULATE_OUTAGE_PROVIDER"] = "groq"
        
        async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60.0) as client:
            resp = await client.post(
                "/api/protocols/create",
                json={"intent": "Thought record exercise for social anxiety"},
                headers={"x-test-outage-provider": "groq"}
            )
            assert resp.status_code == 200, f"Create failed: {resp.status_code} {resp.text}"
            data = resp.json()
            session_id = data["session_id"]
            print(f"Created protocol session: {session_id}")

            # Wait for protocol run to complete (status == 'awaiting_approval' or draft populated)
            for _ in range(30):
                await asyncio.sleep(2)
                st_resp = await client.get(f"/api/protocols/{session_id}/state")
                st = st_resp.json()
                if st.get("current_draft") and len(st.get("current_draft")) > 200:
                    print(f"Draft received ({len(st['current_draft'])} chars). Status: {st.get('status')}")
                    break

        # Load session in UI and take screenshot
        await page.goto(f"http://localhost:3000/?session={session_id}", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        img1 = os.path.join(evidence_dir, "outage_groq_failover.png")
        await page.screenshot(path=img1)
        print(f"[EVIDENCE] Saved Groq failover screenshot to {img1}")

        # -------------------------------------------------------------
        # 2. All Judges Outage Simulation: Fail-closed unverified review
        # -------------------------------------------------------------
        print("\n--- Test 2: Simulating All Judges Outage (Fail-Closed) ---")
        os.environ["SIMULATE_OUTAGE_PROVIDER"] = "all_judges"
        
        async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60.0) as client:
            resp2 = await client.post(
                "/api/protocols/create",
                json={"intent": "Behavioral activation for depression"},
                headers={"x-test-outage-provider": "all_judges"}
            )
            assert resp2.status_code == 200, f"Create failed: {resp2.status_code} {resp2.text}"
            data2 = resp2.json()
            session_id2 = data2["session_id"]
            print(f"Created protocol session (all judges down): {session_id2}")

            for _ in range(30):
                await asyncio.sleep(2)
                st_resp2 = await client.get(f"/api/protocols/{session_id2}/state")
                st2 = st_resp2.json()
                if st2.get("unverified") or st2.get("status") in ["awaiting_approval", "halted"]:
                    print(f"Review halted as expected. Unverified: {st2.get('unverified')}")
                    break

        await page.goto(f"http://localhost:3000/?session={session_id2}", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        img2 = os.path.join(evidence_dir, "outage_all_judges_down.png")
        await page.screenshot(path=img2)
        print(f"[EVIDENCE] Saved All Judges Down screenshot to {img2}")

        await browser.close()

    os.environ.pop("TEST_ALLOW_OUTAGE_SIMULATION", None)
    os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)
    print("\n[SUCCESS] Outage simulation evidence collected successfully.")

if __name__ == "__main__":
    asyncio.run(test_outages())
