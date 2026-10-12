import glob
import os
import re
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from normalizer import normalize_protocol_markdown

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "drafts")

def test_fixtures_normalization():
    fixture_files = glob.glob(os.path.join(FIXTURES_DIR, "draft_*.md"))
    assert len(fixture_files) == 11, f"Expected 11 fixtures, found {len(fixture_files)}"
    
    for fpath in fixture_files:
        with open(fpath, "r", encoding="utf-8") as f:
            raw = f.read()
            
        normalized = normalize_protocol_markdown(raw)
        
        # 1. Exactly one H1
        h1_matches = re.findall(r'^#\s+(.+)$', normalized, re.MULTILINE)
        assert len(h1_matches) == 1, f"File {os.path.basename(fpath)} has {len(h1_matches)} H1 headers: {h1_matches}"
        
        # 2. At least 3 H2 headers
        h2_matches = re.findall(r'^##\s+(.+)$', normalized, re.MULTILINE)
        assert len(h2_matches) >= 3, f"File {os.path.basename(fpath)} has {len(h2_matches)} H2 headers: {h2_matches}"
        
        # 3. No bold pseudo-headings remaining on section lines
        bold_pseudo = re.findall(r'^\*{2}(?:Introduction|Steps|Practice|Reflection|Goals|Objectives|Target Audience|Clinical Objective|Disclaimer|Example):\*{2}', normalized, re.MULTILINE)
        assert len(bold_pseudo) == 0, f"File {os.path.basename(fpath)} still has bold pseudo-headings: {bold_pseudo}"
        
        # 4. No HTML comments
        assert "<!--" not in normalized, f"File {os.path.basename(fpath)} still contains HTML comments"
