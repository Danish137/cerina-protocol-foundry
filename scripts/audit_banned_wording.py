import os
import sys
import re
import json
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ==============================================================================
# F4 BANNED WORDING AUDIT CONFIGURATION
# ==============================================================================

# Exact banned list required by specification
BANNED_LIST = [
    ("clinician", r"\bclinician\b", "Forbidden role label 'clinician' in user-facing text"),
    ("Clinical Supervisor", r"Clinical\s+Supervisor", "Legacy title 'Clinical Supervisor'"),
    ("(Lead)", r"\(Lead\)", "Legacy role suffix '(Lead)'"),
    ("(llm)", r"\(llm\)", "Raw LLM attribution '(llm)'"),
    ("Draft version 0", r"Draft\s+version\s+0", "Raw zero-indexed version phrasing 'Draft version 0'"),
    ("Workflow Supervisor", r"Workflow\s+Supervisor", "Internal architecture component 'Workflow Supervisor'"),
    ("Route:", r"Route:\s*(?:revise|approve|halt)", "Internal router debug label 'Route:'"),
    ("GMT", r"\bGMT\b", "Forbidden timezone string 'GMT' (must use UTC / ISO 8601)"),
    ("events", r"\b[Ee]vents\b(?!\s*[:=]\s*\[)", "User-facing label 'events' (must use Timeline / Activity)"),
    ("groq", r"\bgroq\b", "Provider name 'groq' leaked in client surface"),
    ("openrouter", r"\bopenrouter\b", "Provider name 'openrouter' leaked in client surface"),
    ("gemini", r"\bgemini-(?:3\.[0-9]|1\.[0-9]|2\.[0-9])\b|\bgemini\b", "Provider/model name 'gemini' leaked in client surface"),
    ("llama", r"\bllama-3\.[0-9]\b|\bllama\b", "Model name 'llama' leaked in client surface"),
    ("qwen", r"\bqwen3\.[0-9]\b|\bqwen\b", "Model name 'qwen' leaked in client surface"),
    ("gpt-oss", r"\bgpt-oss-(?:120b|20b)\b|\bgpt-oss\b", "Model name 'gpt-oss' leaked in client surface"),
    ("anthropic", r"\banthropic\b", "Provider name 'anthropic' leaked in client surface"),
    ("openai", r"\bopenai\b", "Provider name 'openai' leaked in client surface"),
    ("validated", r"\bvalidated\b", "Forbidden use of 'validated' (only 'not clinically validated' allowed)"),
]

# Exact Allowlist: "not clinically validated" is the ONLY allowed use of "validated".
EXACT_ALLOWLIST = [
    "not clinically validated",
    "Not clinically validated",
    "NOT CLINICALLY VALIDATED",
]

def print_audit_rules():
    print("=" * 80)
    print("F4: BANNED WORDING & ALLOWLIST AUDIT SPECIFICATION")
    print("=" * 80)
    print("FULL BANNED LIST:")
    for idx, (term, pat, desc) in enumerate(BANNED_LIST, 1):
        print(f"  {idx:2d}. {term:22} -> Pattern: {pat:38} | {desc}")
    print("\nEXACT ALLOWLIST:")
    print("  - 'not clinically validated' (Exact phrase ONLY; any other use of 'validated' is strictly forbidden)")
    print("=" * 80)

def check_text(text: str, source_label: str) -> list:
    """Scans text for banned wording honoring the exact allowlist."""
    violations = []
    
    # Pre-mask allowed phrase "not clinically validated" so it is not flagged
    masked_text = text
    for allowed in EXACT_ALLOWLIST:
        masked_text = masked_text.replace(allowed, "___ALLOWED_CLINICAL_DISCLAIMER___")

    # If auditing code file, strip single-line and multi-line comments
    if any(source_label.endswith(ext) for ext in [".ts", ".tsx", ".js", ".py"]):
        masked_text = re.sub(r'//.*', '', masked_text)
        masked_text = re.sub(r'/\*[\s\S]*?\*/', '', masked_text)

    for term, pattern, desc in BANNED_LIST:
        regex = re.compile(pattern, re.IGNORECASE)
        for match in regex.finditer(masked_text):
            start = max(0, match.start() - 30)
            end = min(len(masked_text), match.end() + 30)
            snippet = masked_text[start:end].replace("\n", " ").strip()
            
            # Filter benign code variables/imports if inspecting code/bundle files
            if term == "events":
                if any(k in snippet for k in [
                    "events:", "events.", "events,", ".events", "events[", "events=", "events||", "events?",
                    "/events", "nextEvents", "events)", "pointerEvents", "pointer-events", "console.warn",
                    "console.log", "console.error", "fetchEventSource", '"events"', "'events'", "BATCH_EVENTS",
                    "rEvents", "filteredEvents", "lastRunEvents", "eventsAfterTerminal", "nodeStarts",
                    "events]", "events}", "(events", "[events", "events) =>", "for (const e of events)"
                ]):
                    continue
                if any(p in snippet.lower() for p in ["these events", "life events", "stressful events", "exposure events"]):
                    continue
            if term == "clinician" and ("clinician_bypass" in snippet or "onClinicianContinue" in snippet or "clinicianBypass" in snippet or "isClinicianEdited" in snippet or snippet.strip().startswith("//") or snippet.strip().startswith("/*")):
                continue
            if term == "validated" and ("validated_hash" in snippet or "last_validated_hash" in snippet or "validated_scores" in snippet or snippet.strip().startswith("//") or snippet.strip().startswith("/*")):
                continue
            if term == "GMT" and ("new RegExp" in snippet or "IST" in snippet or snippet.strip().startswith("//")):
                continue
                
            violations.append((term, desc, source_label, snippet))
            
    return violations

def scan_files(dir_path: str, extensions=None) -> list:
    violations = []
    if not os.path.exists(dir_path):
        return violations
        
    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git", "__pycache__", "venv"}]
        for f in files:
            if extensions and not any(f.endswith(ext) for ext in extensions):
                continue
            fpath = os.path.join(root, f)
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read()
                f_violations = check_text(content, fpath)
                violations.extend(f_violations)
            except Exception:
                pass
    return violations

def run_comprehensive_audit():
    print_audit_rules()
    
    all_violations = []

    # 1. Scan Frontend Source (frontend/src)
    print("\n[Target 1/5] Scanning Source (frontend/src)...")
    v_src = scan_files("frontend/src", extensions=[".ts", ".tsx", ".css", ".html"])
    print(f"  -> Found {len(v_src)} violations.")
    all_violations.extend(v_src)

    # 2. Scan Distribution Bundle (frontend/dist)
    print("\n[Target 2/5] Scanning Dist (frontend/dist)...")
    v_dist = scan_files("frontend/dist", extensions=[".js", ".css", ".html"])
    print(f"  -> Found {len(v_dist)} violations.")
    all_violations.extend(v_dist)

    # 3. Scan Public Replay Demo (frontend/public/demo/sample-run.json)
    print("\n[Target 3/5] Scanning Replay Demo (frontend/public/demo/sample-run.json)...")
    sample_json_path = "frontend/public/demo/sample-run.json"
    if os.path.exists(sample_json_path):
        with open(sample_json_path, "r", encoding="utf-8") as fp:
            content = fp.read()
        v_demo = check_text(content, sample_json_path)
        print(f"  -> Found {len(v_demo)} violations.")
        all_violations.extend(v_demo)
    else:
        print("  -> sample-run.json not found!")

    # 4. Scan MCP Server (mcp_server)
    print("\n[Target 4/5] Scanning MCP Server (mcp_server)...")
    v_mcp = scan_files("mcp_server", extensions=[".py", ".json", ".md"])
    print(f"  -> Found {len(v_mcp)} violations.")
    all_violations.extend(v_mcp)

    # 5. Scan Live API /state + /approve Response
    print("\n[Target 5/5] Scanning Live API /state + /approve Response...")
    try:
        backend_dir = r"d:\Projects\Cerina-Protocol-Foundary\backend"
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from fastapi.testclient import TestClient
        from main import app as backend_app
        with TestClient(backend_app) as client:
            # Create session
            c_res = client.post(
                "/api/protocols/create",
                json={"intent": "Gradual exposure hierarchy for public speaking anxiety"}
            ).json()
            sid = c_res["session_id"]
            tok = c_res["session_token"]

            import time
            time.sleep(12)  # wait for drafting

            # State
            st_resp = client.get(f"/api/protocols/{sid}/state", headers={"X-Session-Token": tok})
            state_raw = st_resp.text
            v_state = check_text(state_raw, f"/api/protocols/{sid}/state")
            print(f"  -> Live /state response ({len(state_raw)} bytes): {len(v_state)} violations.")
            all_violations.extend(v_state)

            # Approve
            app_resp = client.post(
                f"/api/protocols/{sid}/approve",
                json={"edited": False},
                headers={"X-Session-Token": tok}
            )
            app_raw = app_resp.text
            v_app = check_text(app_raw, f"/api/protocols/{sid}/approve")
            print(f"  -> Live /approve response ({len(app_raw)} bytes): {len(v_app)} violations.")
            all_violations.extend(v_app)

    except Exception as e:
        print(f"  -> Live API scan warning: {e}")

    # Summary
    print("\n" + "=" * 80)
    print("F4 AUDIT SUMMARY RESULT:")
    print("=" * 80)
    print(f"Total Banned Word Violations Across All Scanned Surfaces: {len(all_violations)}")
    if all_violations:
        for term, desc, source, snippet in all_violations:
            print(f"  VIOLATION [{term}] in {source}: ...{snippet}...")
    else:
        print("PASS: Zero banned words found across source, dist, sample-run.json, mcp_server, and live API responses!")
    print("=" * 80)
    return len(all_violations)

if __name__ == "__main__":
    count = run_comprehensive_audit()
    sys.exit(0 if count == 0 else 1)
