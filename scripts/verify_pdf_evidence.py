import os, sys
import fitz  # PyMuPDF

def verify_and_render_pdfs():
    evidence_dir = r"d:\Projects\Cerina-Protocol-Foundary\docs\evidence"
    pdf_no_app = os.path.join(evidence_dir, "cerina_protocol_no_appendix.pdf")
    pdf_with_app = os.path.join(evidence_dir, "cerina_protocol_with_appendix.pdf")

    assert os.path.exists(pdf_no_app), f"Missing {pdf_no_app}"
    assert os.path.exists(pdf_with_app), f"Missing {pdf_with_app}"

    log_lines = []
    log_lines.append("=== PDF VERIFICATION PASS 5 ===")

    # 1. Verify cerina_protocol_no_appendix.pdf
    doc_no = fitz.open(pdf_no_app)
    text_no = ""
    for i, page in enumerate(doc_no):
        page_text = page.get_text()
        text_no += f"\n--- Page {i+1} ---\n" + page_text
        # Render image
        pix = page.get_pixmap(dpi=150)
        img_out = os.path.join(evidence_dir, f"pdf_no_appendix_p{i+1}.png" if len(doc_no) > 1 else "pdf_no_appendix.png")
        pix.save(img_out)
        if i == 0:
            pix.save(os.path.join(evidence_dir, "pdf_no_appendix.png"))
        log_lines.append(f"[RENDER] Saved {img_out} ({pix.width}x{pix.height})")

    log_lines.append("\n--- Assertions for PDF Without Appendix ---")
    # Check no raw markdown asterisks
    assert "**" not in text_no, "Assertion Failed: Raw '**' found in PDF text!"
    log_lines.append("[PASS] No raw '**' in extracted text.")

    # Check no missing glyphs
    assert "\ufffd" not in text_no, "Assertion Failed: Replacement char found in PDF text!"
    log_lines.append("[PASS] No missing glyphs in extracted text.")

    # Assert NO GMT (A8)
    assert "GMT" not in text_no, "Assertion Failed: 'GMT' found in PDF text!"
    log_lines.append("[PASS] Verified 'GMT' is absent from PDF text.")

    # Assert NO hash (A8)
    import re
    assert not re.search(r"\b[0-9a-f]{16,64}\b", text_no, re.IGNORECASE), "Assertion Failed: Hash found in PDF text!"
    log_lines.append("[PASS] Verified content hash is absent from PDF text.")

    # Check approval status and disclaimer
    assert "approved by you" in text_no.lower(), "Assertion Failed: Approved by you not found in PDF text!"
    assert "not clinically validated" in text_no.lower(), "Assertion Failed: Disclaimer not found in PDF text!"
    log_lines.append("[PASS] Verified approval status 'Approved by you ... AI-reviewed; not clinically validated' in PDF text.")

    # 2. Verify cerina_protocol_with_appendix.pdf
    doc_with = fitz.open(pdf_with_app)
    text_with = ""
    for i, page in enumerate(doc_with):
        page_text = page.get_text()
        text_with += f"\n--- Page {i+1} ---\n" + page_text
        pix = page.get_pixmap(dpi=150)
        img_out = os.path.join(evidence_dir, f"pdf_with_appendix_p{i+1}.png")
        pix.save(img_out)
        if i == 0:
            pix.save(os.path.join(evidence_dir, "pdf_with_appendix.png"))
        log_lines.append(f"[RENDER] Saved {img_out} ({pix.width}x{pix.height})")

    log_lines.append("\n--- Assertions for PDF With Appendix ---")
    assert "**" not in text_with, "Assertion Failed: Raw '**' found in PDF with appendix!"
    log_lines.append("[PASS] No raw '**' in extracted text.")

    assert "\ufffd" not in text_with, "Assertion Failed: Replacement char found in PDF with appendix!"
    log_lines.append("[PASS] No missing glyphs in extracted text.")

    # Assert NO GMT (A8)
    assert "GMT" not in text_with, "Assertion Failed: 'GMT' found in PDF with appendix!"
    log_lines.append("[PASS] Verified 'GMT' is absent from PDF with appendix.")

    # Assert NO hash (A8)
    assert not re.search(r"\b[0-9a-f]{16,64}\b", text_with, re.IGNORECASE), "Assertion Failed: Hash found in PDF with appendix!"
    log_lines.append("[PASS] Verified content hash is absent from PDF with appendix.")

    assert "independent review details" in text_with.lower() or "review details" in text_with.lower(), "Assertion Failed: Appendix heading missing!"
    log_lines.append("[PASS] Appendix heading 'Independent Review Details' verified.")

    # Check no clinician/supervisor validation claims
    positive_banned = ["clinician revision", "clinically validated protocol", "approved by clinician", "supervisor approved", "clinical validation complete"]
    for b in positive_banned:
        assert b not in text_with.lower(), f"Assertion Failed: Disallowed positive claim '{b}' found in PDF!"
    assert "not clinically validated" in text_with.lower(), "Assertion Failed: Negative disclaimer 'not clinically validated' missing!"
    log_lines.append("[PASS] Purged all positive clinical validation / clinician revision claims; explicit 'not clinically validated' disclaimer present.")

    out_log = os.path.join(evidence_dir, "pdf_verification_log.txt")
    with open(out_log, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines) + "\n\n" + "=== EXTRACTED TEXT (PDF WITH APPENDIX) ===\n" + text_with)
    print(f"[SUCCESS] PDF verification assertions passed! Log saved to {out_log}")
    for l in log_lines:
        print(l)

if __name__ == "__main__":
    verify_and_render_pdfs()
