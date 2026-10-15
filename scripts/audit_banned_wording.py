import os
import sys
import re

# Banned phrases that should never appear in user-facing UI, PDF, default API, or replay fixtures
BANNED_PATTERNS = [
    (r"\(llm\)", "LLM suffix in UI/output"),
    (r"Draft version 0", "Raw draft version 0 phrasing"),
    (r"Workflow Supervisor", "Old Workflow Supervisor naming"),
    (r"Clinical Supervisor", "Old Clinical Supervisor attribution"),
    (r"Route:\s*(?:revise|approve|halt)", "Internal router debug text"),
    (r"groq", "Provider name Groq in client surfaces"),
    (r"openrouter", "Provider name OpenRouter in client surfaces"),
    (r"gemini-(?:3\.[0-9]|1\.[0-9]|2\.[0-9])", "Model name Gemini in client surfaces"),
    (r"llama-3\.[0-9]", "Model name LLaMA in client surfaces"),
    (r"qwen3\.[0-9]", "Model name Qwen in client surfaces"),
    (r"gpt-oss-120b", "Model name GPT in client surfaces"),
]

# Client-facing surfaces to audit
CHECK_PATHS = [
    "frontend/src",
    "frontend/public",
    "frontend/dist",
]

SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", ".gemini", "fonts", "__pycache__"}
ALLOW_EXTENSIONS = {".ts", ".tsx", ".json", ".html", ".css", ".js"}

def run_audit():
    compiled = [(re.compile(p, re.IGNORECASE), desc) for p, desc in BANNED_PATTERNS]
    hits = []
    
    for base in CHECK_PATHS:
        if not os.path.exists(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext not in ALLOW_EXTENSIONS:
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                        for lno, line in enumerate(fp, 1):
                            # Skip comments if possible, but audit all strings
                            for pat, desc in compiled:
                                match = pat.search(line)
                                if match:
                                    # Exclude source map / package / font metadata references if purely benign
                                    hits.append((desc, path, lno, line.strip()[:100]))
                except Exception as e:
                    pass

    print("=" * 70)
    print("F4 BANNED WORDING & PROVIDER NAME AUDIT REPORT")
    print("=" * 70)
    print(f"Total violations found: {len(hits)}")
    for desc, path, lno, snippet in hits:
        # Safe ASCII representation for Windows consoles
        safe_snip = snippet.encode("ascii", errors="replace").decode("ascii")
        print(f"  [{desc}] {path}:{lno} -> {safe_snip}")
    print("=" * 70)
    return len(hits)

if __name__ == "__main__":
    count = run_audit()
    sys.exit(0 if count == 0 else 1)
