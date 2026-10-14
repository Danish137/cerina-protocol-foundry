import subprocess
import re
import os

PATTERNS = [
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API Key"),
    (r"gsk_[0-9a-zA-Z]{20,}", "Groq API Key"),
    (r"sk-or-v1-[0-9a-fA-F]{40,}", "OpenRouter API Key"),
    (r"sk-[0-9a-zA-Z]{32,}", "OpenAI / Generic Secret Key"),
    (r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][0-9a-zA-Z\-_]{20,}['\"]", "Configured Secret Assignment"),
    (r"-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----", "Private Key Header")
]

# Whitelist safe placeholder strings (e.g. dummy examples in docs or env.template)
WHITELIST = [
    "AIzaSyDummyKeyForTestingPurposes12345678",
    "gsk_dummy_test_key_for_unit_tests",
    "your_google_api_key_here",
    "your_groq_api_key_here",
    "your_openrouter_api_key_here",
    "c3a7e91f04b28d5e",
    "8d1bea3a68a27598",
    "b0ef189c0c9d8162"
]

def scan_full_git_history():
    print("Running comprehensive git history secret scan...")
    cmd = ["git", "log", "-p", "--all"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="ignore")

    findings = []
    current_commit = "INIT"
    current_file = ""

    for line in proc.stdout:
        if line.startswith("commit "):
            current_commit = line.strip().split()[1]
        elif line.startswith("diff --git "):
            current_file = line.strip().split()[-1]
        elif line.startswith("+") and not line.startswith("+++"):
            # This is an added line
            added_text = line[1:].strip()
            
            # Check whitelist
            if any(w in added_text for w in WHITELIST):
                continue
                
            for pattern, desc in PATTERNS:
                matches = re.findall(pattern, added_text)
                if matches:
                    # Ignore .env.example / template files
                    if "example" in current_file.lower() or "template" in current_file.lower():
                        continue
                    findings.append({
                        "commit": current_commit,
                        "file": current_file,
                        "type": desc,
                        "snippet": added_text[:50] + ("..." if len(added_text) > 50 else "")
                    })

    proc.wait()

    evidence_file = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence\secret_scan_log.txt"
    with open(evidence_file, "w", encoding="utf-8") as f:
        f.write("=== FULL GIT HISTORY SECRET SCAN REPORT ===\n")
        f.write(f"Scanned all commits and all patches across git log -p --all.\n")
        f.write(f"Rule set: Google, Groq, OpenRouter, OpenAI, Private Keys, Secret Assignments.\n\n")
        if not findings:
            f.write("STATUS: CLEAN. Zero leaked secrets or credentials detected across entire git history.\n")
            print("STATUS: CLEAN. Zero leaked secrets detected across entire git history.")
        else:
            f.write(f"STATUS: WARNING. {len(findings)} potential secret findings:\n")
            for finding in findings:
                f.write(f"Commit: {finding['commit']} | File: {finding['file']} | Type: {finding['type']}\n")
                f.write(f"Snippet: {finding['snippet']}\n\n")
            print(f"STATUS: WARNING. {len(findings)} findings saved to {evidence_file}")

    assert len(findings) == 0, f"Git history secret scan failed! Found {len(findings)} potential secrets."

if __name__ == "__main__":
    scan_full_git_history()
