import os
import sys
import asyncio
from playwright.async_api import async_playwright
from axe_playwright_python.async_playwright import Axe

async def run_axe():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1440, "height": 900})
        await page.goto("http://localhost:3000/", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        axe = Axe()
        results = await axe.run(page)
        
        serious_critical = [v for v in results.response.get("violations", []) if v.get("impact") in ["serious", "critical"]]
        
        print("=" * 70)
        print("F12 AXE-CORE ACCESSIBILITY AUDIT REPORT")
        print("=" * 70)
        print(f"Total violations count: {results.violations_count}")
        print(f"Serious / Critical violations: {len(serious_critical)}")
        
        for v in results.response.get("violations", []):
            print(f"- Rule: {v.get('id')} | Impact: {v.get('impact')} | Nodes affected: {len(v.get('nodes', []))}")
            for node in v.get("nodes", [])[:2]:
                print(f"    Target: {node.get('target')} -> {node.get('failureSummary', '').splitlines()[0] if node.get('failureSummary') else ''}")
                
        print("=" * 70)
        await browser.close()
        return len(serious_critical)

if __name__ == "__main__":
    count = asyncio.run(run_axe())
    sys.exit(0 if count == 0 else 1)
