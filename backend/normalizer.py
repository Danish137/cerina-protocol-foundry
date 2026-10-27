"""
Markdown Protocol Normalizer
Standardizes LLM draft variants into a canonical hierarchy:
- Exactly one H1 (# Title)
- Canonical H2 sections (## Introduction, ## Goals, ## Steps, ## Practice, ## Reflection, ## Conclusion)
- Nested H3 steps (### Step n: ...)
- Eliminates bold pseudo-headings (**Section:**) and plain-line headers
- Replaces write-in fill-in lines (_{4,} or empty numbers) with {{write-in:N}}
"""

import re
from typing import List

CANONICAL_SECTIONS = [
    "Introduction",
    "Goals",
    "Objectives",
    "Target Audience",
    "Clinical Objective",
    "Steps",
    "Practice",
    "Reflection",
    "Conclusion",
    "Homework",
    "Disclaimer",
    "Example"
]

def normalize_protocol_markdown(raw_markdown: str) -> str:
    """
    Tolerates all 4 observed LLM draft variants:
    1. Full standard markdown hierarchy (#, ##, ###)
    2. ### / #### section headers (missing # or ##)
    3. Bold pseudo-headings (**Name:** or **Name**)
    4. Plain-line section names without markdown syntax
    """
    if not raw_markdown:
        return ""

    # 1. Strip HTML comments
    text = re.sub(r'<!--.*?-->', '', raw_markdown, flags=re.DOTALL)
    
    # 2. Normalize line endings
    lines = [line.rstrip() for line in text.splitlines()]
    
    # 3. Collapse runs of write-in underscore lines / empty numbered items
    processed_lines: List[str] = []
    write_in_buffer: List[str] = []
    
    def flush_write_in():
        nonlocal write_in_buffer
        if write_in_buffer:
            count = len(write_in_buffer)
            processed_lines.append(f"{{{{write-in:{count}}}}}")
            write_in_buffer = []

    for line in lines:
        stripped = line.strip()
        is_write_in = False
        if re.match(r'^(\d+\.\s*)?_{4,}\s*$', stripped):
            is_write_in = True
        elif re.match(r'^\d+\.\s*$', stripped):
            is_write_in = True
            
        if is_write_in:
            write_in_buffer.append(stripped)
        else:
            flush_write_in()
            processed_lines.append(line)
    flush_write_in()

    # 4. Normalize headings and pseudo-headings
    output_lines: List[str] = []
    first_heading_seen = False
    
    section_names_lower = {s.lower(): s for s in CANONICAL_SECTIONS}
    step_pattern = re.compile(r'^(?:(?:\*{2})?Step\s*(\d+)[:.]?(?:\*{2})?|\bStep\s*(\d+)[:.]?)\s*(.*)$', re.IGNORECASE)

    for i, line in enumerate(processed_lines):
        stripped = line.strip()
        if not stripped:
            output_lines.append("")
            continue

        # Check Step lines -> ### Step n: ...
        step_match = step_pattern.match(stripped)
        if step_match and not stripped.startswith('#'):
            num = step_match.group(1) or step_match.group(2) or "1"
            rest = (step_match.group(3) or "").strip()
            if rest.startswith(':'):
                rest = rest[1:].strip()
            rest = re.sub(r'^\*{2}(.*?)\*{2}', r'\1', rest).strip()
            if rest:
                output_lines.append(f"### Step {num}: {rest}")
            else:
                output_lines.append(f"### Step {num}")
            continue

        # Check existing markdown headings (#, ##, ###, ####)
        header_match = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if header_match:
            hashes = header_match.group(1)
            title = header_match.group(2).strip()
            title_clean = re.sub(r'^\*{2}(.*?)\*{2}:?$', r'\1', title).strip().rstrip(':')

            # Is it the very first heading in document?
            if not first_heading_seen:
                first_heading_seen = True
                # If first heading is a canonical section (like 'Introduction'), prepend default title
                if title_clean.lower() in section_names_lower:
                    output_lines.append("# Clinical CBT Protocol")
                    output_lines.append("")
                    output_lines.append(f"## {section_names_lower[title_clean.lower()]}")
                    continue
                else:
                    # It's the document title
                    output_lines.append(f"# {title_clean}")
                    continue

            # If it matches a canonical section name (e.g. Introduction, Steps, Conclusion)
            if title_clean.lower() in section_names_lower:
                canonical = section_names_lower[title_clean.lower()]
                output_lines.append(f"## {canonical}")
                continue

            # If it's a step
            if "step" in title_clean.lower() and re.search(r'\d+', title_clean):
                output_lines.append(f"### {title_clean}")
                continue

            # Demote extra H1s to H2
            if hashes == "#":
                output_lines.append(f"## {title_clean}")
            elif len(hashes) >= 4:
                # Demote H4 to H3
                output_lines.append(f"### {title_clean}")
            else:
                output_lines.append(stripped)
            continue

        # Check bold pseudo-headings: **Introduction:** or **Introduction**
        bold_match = re.match(r'^\*{2}(.*?)\*{2}:?$', stripped)
        if bold_match:
            candidate = bold_match.group(1).strip().rstrip(':')
            if candidate.lower() in section_names_lower:
                canonical = section_names_lower[candidate.lower()]
                if not first_heading_seen:
                    output_lines.append("# Clinical CBT Protocol")
                    output_lines.append("")
                    first_heading_seen = True
                output_lines.append(f"## {canonical}")
                continue
            elif "step" in candidate.lower() and re.search(r'\d+', candidate):
                output_lines.append(f"### {candidate}")
                continue

        # Check plain-line canonical section names (e.g. "Introduction" or "Introduction:")
        plain_candidate = stripped.rstrip(':')
        if plain_candidate.lower() in section_names_lower:
            canonical = section_names_lower[plain_candidate.lower()]
            if not first_heading_seen:
                output_lines.append("# Clinical CBT Protocol")
                output_lines.append("")
                first_heading_seen = True
            output_lines.append(f"## {canonical}")
            continue

        output_lines.append(line)

    result_text = "\n".join(output_lines).strip()

    # 5. Final check: Ensure exactly one H1 exists at the top
    h1_matches = list(re.finditer(r'^#\s+(.+)$', result_text, re.MULTILINE))
    if not h1_matches:
        result_text = "# Clinical CBT Protocol\n\n" + result_text
    elif len(h1_matches) > 1:
        lines = result_text.splitlines()
        first_h1_found = False
        for idx, l in enumerate(lines):
            if l.startswith('# '):
                if not first_h1_found:
                    first_h1_found = True
                else:
                    lines[idx] = '#' + l # convert to ##
        result_text = "\n".join(lines)

    # 6. Ensure at least 3 H2 sections exist
    h2_count = len(re.findall(r'^##\s+', result_text, re.MULTILINE))
    if h2_count < 3:
        # Promote ### to ## if they are top-level section candidates
        lines = result_text.splitlines()
        for idx, l in enumerate(lines):
            if l.startswith('### ') and not re.search(r'step\s*\d', l, re.IGNORECASE):
                lines[idx] = l[1:] # convert ### to ##
                h2_count += 1
                if h2_count >= 3:
                    break
        result_text = "\n".join(lines)

    return result_text.strip()
