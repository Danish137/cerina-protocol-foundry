import os, sys, time, asyncio, subprocess
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

async def record_pdf_export():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        v_dir = os.path.join(temp_video_dir, "pdf_export_run")
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
            print("Streaming recorded run...")
            # Wait for replay to finish and reach approved state
            print("Waiting for Export Clinical PDF button...")
            await page.wait_for_selector("button:has-text('Export Clinical PDF'), button:has-text('Export PDF')", timeout=20000)
            await page.wait_for_timeout(1500)

            # In approved state: Export without appendix
            pdf_btn = page.locator("button:has-text('Export Clinical PDF'), button:has-text('Export PDF')")
            if await pdf_btn.count() > 0:
                print("Clicking Export Clinical PDF (without appendix)...")
                await pdf_btn.first.click()
                await page.wait_for_timeout(2000)

            # Check "Include review details in PDF export"
            chk = page.locator("input[type='checkbox']")
            if await chk.count() > 0:
                print("Checking 'Include review details in PDF export'...")
                await chk.first.check()
                await page.wait_for_timeout(1000)

            # Export with appendix
            if await pdf_btn.count() > 0:
                print("Clicking Export Clinical PDF (with appendix)...")
                await pdf_btn.first.click()
                await page.wait_for_timeout(2500)

        await page.close()
        await ctx.close()
        await browser.close()

        webms = [os.path.join(v_dir, f) for f in os.listdir(v_dir) if f.endswith(".webm")]
        if webms:
            out_mp4 = os.path.join(evidence_dir, "recording_pdf_export.mp4")
            convert_webm_to_mp4(webms[-1], out_mp4)

if __name__ == "__main__":
    asyncio.run(record_pdf_export())
