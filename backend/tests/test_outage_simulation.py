import os
import sys
import asyncio
import secrets
import pytest
import httpx
from playwright.async_api import async_playwright

backend_dir = r"d:\Projects\Cerina-Protocol-Foundary\backend"
evidence_dir = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence"
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(backend_dir, 'cerina_foundry.db')}"
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from database import get_db_session, ProtocolSession
from security import generate_session_id, generate_session_token, hash_token
from agents.state import create_initial_state
from agents.workflow import create_workflow, init_checkpointer_async
from runner import run_protocol_workflow

@pytest.mark.asyncio
async def test_outage_simulation():
    await init_checkpointer_async()
    os.environ["MOCK_LLM"] = "false"
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

        session_id_1 = generate_session_id()
        session_token_1 = generate_session_token()
        token_hash_1 = hash_token(session_token_1)
        run_id_1 = f"run_{secrets.token_urlsafe(8)}"

        db = get_db_session()
        try:
            sess1 = ProtocolSession(
                session_id=session_id_1,
                token_hash=token_hash_1,
                user_intent="Thought record exercise for social anxiety",
                status="generating",
                review_depth="standard",
                current_run_id=run_id_1
            )
            db.add(sess1)
            db.commit()
        finally:
            db.close()

        workflow = create_workflow()
        config_1 = {"configurable": {"thread_id": session_id_1}}
        init_st_1 = create_initial_state(
            user_intent="Thought record exercise for social anxiety",
            session_id=session_id_1
        )
        init_st_1["review_depth"] = "standard"
        init_st_1["run_id"] = run_id_1
        init_st_1["session_token"] = session_token_1
        await workflow.aupdate_state(config_1, init_st_1)

        print(f"Running pipeline for Groq failover: {session_id_1}...")
        await run_protocol_workflow(session_id_1, run_id=run_id_1, run_kind="initial", review_depth="standard")

        st_1 = await workflow.aget_state(config_1)
        assert st_1.values.get("current_draft") and len(st_1.values.get("current_draft")) > 200
        print(f"Draft received ({len(st_1.values['current_draft'])} chars). Status: {st_1.values.get('status')}")

        # Load session in UI and take screenshot
        await page.goto("http://localhost:3000/", wait_until="networkidle")
        await page.evaluate("""(data) => {
            const sess = [
                {
                    id: data.id,
                    token: data.token,
                    intent: "Thought record exercise for social anxiety",
                    review_depth: "standard",
                    status: "awaiting_approval",
                    updated_at: new Date().toISOString()
                }
            ];
            localStorage.setItem("cerina_recent_sessions", JSON.stringify(sess));
        }""", {"id": session_id_1, "token": session_token_1})
        await page.goto(f"http://localhost:3000/?s={session_id_1}", wait_until="networkidle")
        await page.wait_for_timeout(3000)
        img1 = os.path.join(evidence_dir, "outage_groq_failover.png")
        await page.screenshot(path=img1)
        print(f"[EVIDENCE] Saved Groq failover screenshot to {img1}")

        # -------------------------------------------------------------
        # 2. All Judges Outage Simulation: Fail-Closed Unverified Review
        # -------------------------------------------------------------
        print("\n--- Test 2: Simulating All Judges Outage (Fail-Closed) ---")
        os.environ["SIMULATE_OUTAGE_PROVIDER"] = "all_judges"

        session_id_2 = generate_session_id()
        session_token_2 = generate_session_token()
        token_hash_2 = hash_token(session_token_2)
        run_id_2 = f"run_{secrets.token_urlsafe(8)}"

        db = get_db_session()
        try:
            sess2 = ProtocolSession(
                session_id=session_id_2,
                token_hash=token_hash_2,
                user_intent="Behavioral activation for depression",
                status="generating",
                review_depth="standard",
                current_run_id=run_id_2
            )
            db.add(sess2)
            db.commit()
        finally:
            db.close()

        config_2 = {"configurable": {"thread_id": session_id_2}}
        init_st_2 = create_initial_state(
            user_intent="Behavioral activation for depression",
            session_id=session_id_2
        )
        init_st_2["review_depth"] = "standard"
        init_st_2["run_id"] = run_id_2
        init_st_2["session_token"] = session_token_2
        await workflow.aupdate_state(config_2, init_st_2)

        print(f"Running pipeline with all_judges down: {session_id_2}...")
        await run_protocol_workflow(session_id_2, run_id=run_id_2, run_kind="initial", review_depth="standard")

        st_2 = await workflow.aget_state(config_2)
        print(f"Review halted as expected. Status: {st_2.values.get('status')}, Unverified: {st_2.values.get('unverified')}")

        # Assertion A: Protocol state is flagged as unverified
        assert st_2.values.get("unverified") is True, f"Assertion Error: State not flagged as unverified! State: {st_2.values}"
        print("  [PASS] Asserted protocol state is flagged as unverified=True.")

        # Seed localStorage and navigate to session in UI
        await page.goto("http://localhost:3000/", wait_until="networkidle")
        await page.evaluate("""(data) => {
            const sess = [
                {
                    id: data.id,
                    token: data.token,
                    intent: "Behavioral activation for depression",
                    review_depth: "standard",
                    status: "awaiting_approval",
                    updated_at: new Date().toISOString()
                }
            ];
            localStorage.setItem("cerina_recent_sessions", JSON.stringify(sess));
        }""", {"id": session_id_2, "token": session_token_2})
        await page.goto(f"http://localhost:3000/?s={session_id_2}", wait_until="networkidle")
        await page.wait_for_timeout(3000)

        # Assertion B: 'Not verified' text is in the DOM
        dom_content = await page.content()
        assert "Not verified" in dom_content, "Assertion Error: 'Not verified' text missing from DOM in all-judges-down case!"
        print("  [PASS] Asserted 'Not verified' text is in the DOM.")

        # Assertion C: Approval is blocked when edited (server enforces 409 recheck_required)
        async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=15.0) as client:
            approve_resp = await client.post(
                f"/api/protocols/{session_id_2}/approve",
                json={
                    "approved_content": st_2.values.get("current_draft", "") + "\nEdited text during outage",
                    "edited": True,
                    "approved_by": "Test Clinician"
                },
                headers={"X-Session-Token": session_token_2}
            )
            assert approve_resp.status_code == 409, f"Expected 409 recheck_required, got {approve_resp.status_code}"
            assert approve_resp.json().get("detail", {}).get("code") == "recheck_required"
            print("  [PASS] Asserted approval is blocked (HTTP 409 recheck_required) for unverified edits.")

        img2 = os.path.join(evidence_dir, "outage_all_judges_down.png")
        await page.screenshot(path=img2)
        print(f"[EVIDENCE] Saved All Judges Down screenshot to {img2}")

        await browser.close()

    os.environ.pop("TEST_ALLOW_OUTAGE_SIMULATION", None)
    os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)
    print("\n[SUCCESS] Outage simulation test passed completely.")

if __name__ == "__main__":
    asyncio.run(test_outage_simulation())
