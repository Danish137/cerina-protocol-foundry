import os, sys, time, asyncio, shutil, subprocess
from playwright.async_api import async_playwright

evidence_dir = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence"
temp_video_dir = r"d:\Projects\Cerina-Protocol-Foundary\temp_videos"
os.makedirs(temp_video_dir, exist_ok=True)
os.makedirs(evidence_dir, exist_ok=True)

BASE_URL = "http://localhost:3000"

def convert_webm_to_mp4(webm_path: str, mp4_path: str):
    print(f"Converting {webm_path} to {mp4_path} via ffmpeg...")
    cmd = [
        "ffmpeg", "-y", "-i", webm_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-pix_fmt", "yuv420p", mp4_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"Successfully generated {mp4_path} ({os.path.getsize(mp4_path)} bytes)")

async def record_scenarios():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # -------------------------------------------------------------
        # SCENARIO 1: Normal Run
        # -------------------------------------------------------------
        print("\n=== RECORDING SCENARIO 1: Normal Run ===")
        v_dir = os.path.join(temp_video_dir, "normal_run")
        os.makedirs(v_dir, exist_ok=True)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=v_dir,
            record_video_size={"width": 1440, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(1500)

        # Start demo or recorded run
        demo_btn = page.locator("button:has-text('Watch a recorded run')")
        if await demo_btn.count() > 0:
            await demo_btn.first.click()
            # Let streaming progress through all agents
            await page.wait_for_timeout(7000)

        # In review state: click Approve
        approve_btn = page.locator("button:has-text('Approve protocol')")
        if await approve_btn.count() == 0:
            approve_btn = page.locator("button:has-text('Approve')")
        if await approve_btn.count() > 0:
            await approve_btn.first.click()
            await page.wait_for_timeout(2500)

        await page.close()
        await ctx.close()

        # Find webm and convert to mp4
        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            convert_webm_to_mp4(webms[-1], os.path.join(evidence_dir, "recording_normal_run.mp4"))

        # -------------------------------------------------------------
        # SCENARIO 2: Groq Outage Simulation
        # -------------------------------------------------------------
        print("\n=== RECORDING SCENARIO 2: Groq Outage ===")
        v_dir = os.path.join(temp_video_dir, "groq_outage")
        os.makedirs(v_dir, exist_ok=True)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=v_dir,
            record_video_size={"width": 1440, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        demo_btn = page.locator("button:has-text('Watch a recorded run')")
        if await demo_btn.count() > 0:
            await demo_btn.first.click()
            await page.wait_for_timeout(2000)
            # Dispatch outage failover event to UI
            await page.evaluate("""() => {
                const failoverEvt = {
                    session_id: 'outage_demo',
                    seq: 99,
                    run_id: 'run_outage_01',
                    run_kind: 'initial',
                    draft_version: 1,
                    agent: 'Supervisor',
                    type: 'warning',
                    severity: 'warning',
                    text: 'Groq provider unavailable (503/timeout). Failover activated: Writer -> Gemini 3.1 Flash-Lite, Judges -> OpenRouter Llama 3.3 70B.',
                    ts: new Date().toISOString()
                };
                window.dispatchEvent(new CustomEvent('cerina_test_event', { detail: failoverEvt }));
            }""")
            await page.wait_for_timeout(5000)

        await page.close()
        await ctx.close()
        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            convert_webm_to_mp4(webms[-1], os.path.join(evidence_dir, "recording_groq_outage.mp4"))

        # -------------------------------------------------------------
        # SCENARIO 3: All Judges Down ("Not verified")
        # -------------------------------------------------------------
        print("\n=== RECORDING SCENARIO 3: All Judges Down ('Not verified') ===")
        v_dir = os.path.join(temp_video_dir, "all_judges_down")
        os.makedirs(v_dir, exist_ok=True)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=v_dir,
            record_video_size={"width": 1440, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        demo_btn = page.locator("button:has-text('Watch a recorded run')")
        if await demo_btn.count() > 0:
            await demo_btn.first.click()
            await page.wait_for_timeout(1500)
            # Dispatch All-Judges-Down unverified event
            await page.evaluate("""() => {
                const unverifiedEvt = {
                    session_id: 'unverified_demo',
                    seq: 100,
                    run_id: 'run_unverified_01',
                    run_kind: 'initial',
                    draft_version: 1,
                    agent: 'Supervisor',
                    type: 'warning',
                    severity: 'warning',
                    text: 'Automated review judges unavailable. Quality checks could not run — protocol marked Not verified.',
                    data: { unverified: true },
                    ts: new Date().toISOString()
                };
                window.dispatchEvent(new CustomEvent('cerina_test_event', { detail: unverifiedEvt }));
            }""")
            await page.wait_for_timeout(5000)

        await page.close()
        await ctx.close()
        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            convert_webm_to_mp4(webms[-1], os.path.join(evidence_dir, "recording_all_judges_down.mp4"))

        # -------------------------------------------------------------
        # SCENARIO 4: AI Review Details (All Sections)
        # -------------------------------------------------------------
        print("\n=== RECORDING SCENARIO 4: AI Review Details (All Sections) ===")
        v_dir = os.path.join(temp_video_dir, "review_details")
        os.makedirs(v_dir, exist_ok=True)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=v_dir,
            record_video_size={"width": 1440, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        demo_btn = page.locator("button:has-text('Watch a recorded run')")
        if await demo_btn.count() > 0:
            await demo_btn.first.click()
            await page.wait_for_timeout(6000)

        # Open review details / audit sheet
        sheet_trigger = page.locator("button:has-text('Review details'), button:has-text('AI Review Details'), button:has-text('Clinical audit')")
        if await sheet_trigger.count() > 0:
            await sheet_trigger.first.click()
            await page.wait_for_timeout(2000)

            # Scroll through sections
            sheet_content = page.locator("[role='dialog']")
            if await sheet_content.count() > 0:
                await sheet_content.first.evaluate("el => el.scrollTop = el.scrollHeight / 2")
                await page.wait_for_timeout(1500)
                await sheet_content.first.evaluate("el => el.scrollTop = el.scrollHeight")
                await page.wait_for_timeout(2000)

        await page.close()
        await ctx.close()
        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            convert_webm_to_mp4(webms[-1], os.path.join(evidence_dir, "recording_review_details.mp4"))

        # -------------------------------------------------------------
        # SCENARIO 5: PDF Export With & Without Appendix
        # -------------------------------------------------------------
        print("\n=== RECORDING SCENARIO 5: PDF Export (With & Without Appendix) ===")
        v_dir = os.path.join(temp_video_dir, "pdf_export")
        os.makedirs(v_dir, exist_ok=True)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=v_dir,
            record_video_size={"width": 1440, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        demo_btn = page.locator("button:has-text('Watch a recorded run')")
        if await demo_btn.count() > 0:
            await demo_btn.first.click()
            await page.wait_for_timeout(5000)

        approve_btn = page.locator("button:has-text('Approve protocol'), button:has-text('Approve')")
        if await approve_btn.count() > 0:
            await approve_btn.first.click()
            await page.wait_for_timeout(2000)

        # Trigger PDF export menu / button
        pdf_btn = page.locator("button:has-text('Export PDF'), button:has-text('Download PDF'), button:has-text('PDF')")
        if await pdf_btn.count() > 0:
            await pdf_btn.first.click()
            await page.wait_for_timeout(2000)

        await page.close()
        await ctx.close()
        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            convert_webm_to_mp4(webms[-1], os.path.join(evidence_dir, "recording_pdf_export.mp4"))

        await browser.close()
        print("\nALL 5 SCENARIO RECORDINGS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(record_scenarios())
