import os
import sys
import re
import subprocess

# Common secret regex patterns
SECRET_PATTERNS = [
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API Key"),
    (r"gsk_[a-zA-Z0-9]{40,}", "Groq API Key"),
    (r"sk-or-v1-[a-zA-Z0-9]{60,}", "OpenRouter API Key"),
    (r"-----BEGIN (?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----", "Private Key"),
    (r"(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{24,}['\"]", "Generic API Key/Token Assignment")
]

# Files/paths to exclude (e.g. .env which is in .gitignore, git objects)
IGNORE_PATHS = [".git", "venv", ".venv", "node_modules", ".gemini", "dist", ".pytest_cache"]

# Known dummy placeholders that are not actual keys
DUMMY_PATTERNS = [
    "DummyKey", "dummy_test", "your_google_api_key_here", "your_groq_api_key_here"
]

from dotenv import load_dotenv
load_dotenv(os.path.join("backend", ".env"))

def scan_files():
    compiled = [(re.compile(p), desc) for p, desc in SECRET_PATTERNS]
    leaks = []
    
    # 1. Scan repo working tree (excluding .env)
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE_PATHS]
        for f in files:
            if f.endswith(".env") or f == ".env.example":
                continue
            path = os.path.join(root, f)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                    for lno, line in enumerate(fp, 1):
                        if any(d in line for d in DUMMY_PATTERNS):
                            continue
                        for pat, desc in compiled:
                            if pat.search(line):
                                leaks.append((path, lno, desc))
            except Exception:
                pass

    # 2. Scan git commit diffs across entire history
    try:
        git_diff = subprocess.check_output(
            ["git", "log", "-p", "--all"],
            stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="ignore")
        
        for lno, line in enumerate(git_diff.splitlines(), 1):
            if not line.startswith("+"):
                continue
            if any(d in line for d in DUMMY_PATTERNS):
                continue
            # Ignore deleted diffs or comments in docs
            for pat, desc in compiled:
                if pat.search(line):
                    # Check if it was in .env file diff
                    if "diff --git a/.env" not in line:
                        leaks.append(("git history commit diff", lno, desc))
    except Exception as e:
        print(f"Git log scan error: {e}")

    print("=" * 70)
    print("PART 3 SECRETS SCAN REPORT")
    print("=" * 70)
    print(f"Total potential secret leaks detected: {len(leaks)}")
    for src, lno, desc in leaks:
        print(f"  [ALERT] {desc} found at {src}:{lno}")
        
    print("\n--- Environment Key Configuration Status ---")
    keys = ["GROQ_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "SESSION_SECRET"]
    for k in keys:
        val = os.getenv(k)
        status = "set" if val and len(val.strip()) > 0 else "not set"
        print(f"  {k}: {status}")
    print("=" * 70)
    return len(leaks)

if __name__ == "__main__":
    count = scan_files()
    sys.exit(0 if count == 0 else 1)
