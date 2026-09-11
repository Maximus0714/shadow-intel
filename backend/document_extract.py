"""Safe text extraction for narrative evidence uploads."""
from io import BytesIO
import re


TEXT_SUFFIXES = (".txt", ".md", ".vtt", ".srt")


def _reflow(text):
    """Join PDF visual line wraps, preserving paragraph and sentence boundaries."""
    paragraphs, current = [], ""
    for line in text.replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = ""
            continue
        if current and (re.search(r"[.!?]$", current) or re.match(r"^(?:[-•]|\d+[.)])\s|^[\w '-]{2,60}:\s", line)):
            paragraphs.append(current)
            current = ""
        current = (current + " " + line).strip()
    if current:
        paragraphs.append(current)
    return "\n".join(paragraphs)


def extract_document_text(filename, content):
    name = (filename or "").lower()
    if name.endswith(TEXT_SUFFIXES):
        return content.decode("utf-8-sig"), {"source_type": "text", "pages": None}
    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            reader = PdfReader(BytesIO(content))
        except Exception as error:
            raise ValueError("The PDF could not be opened. Check that it is valid and not password protected.") from error
        try:
            if reader.is_encrypted:
                raise ValueError("Password-protected PDFs are not supported.")
            if len(reader.pages) > 300:
                raise ValueError("PDFs may contain at most 300 pages.")
            sections, size = [], 0
            for number, page in enumerate(reader.pages, 1):
                text = _reflow(page.extract_text() or "")
                size += len(text) + 2
                if size > 500_000:
                    raise ValueError("Extracted PDF text exceeds 500,000 characters. Split the PDF.")
                sections.append({"page": number, "text": text})
        except ValueError:
            raise
        except Exception as error:
            raise ValueError("A PDF page could not be read. Export a fresh text-based PDF and retry.") from error
        text = "\n\n".join(section["text"] for section in sections)
        if not text.strip():
            raise ValueError("No selectable text was found. Run OCR on this scanned PDF, then upload it again.")
        return text, {"source_type": "pdf", "pages": len(sections), "sections": sections,
                      "empty_pages": [s["page"] for s in sections if not s["text"]]}
    raise ValueError("Upload PDF, TXT, Markdown, SRT or VTT evidence.")


def extract_uploaded_narrative(filename, content):
    from .narrative import extract_narrative
    text, meta = extract_document_text(filename, content)
    if meta["source_type"] != "pdf":
        return extract_narrative(text)
    result = {"records": [], "entities": [], "unresolved": [], "source_text": text, "warnings": []}
    entities, offset = {}, 0
    for section in meta["sections"]:
        if section["text"]:
            # Reset pronoun context at page boundaries; never connect unrelated pages.
            page_result = extract_narrative(section["text"])
            for row in page_result["records"]:
                row["attributes"]["source_page"] = str(section["page"])
                row["attributes"]["source_file"] = filename
                row["source_rows"] = [line + offset for line in row["source_rows"]]
                result["records"].append(row)
            for item in page_result["unresolved"]:
                result["unresolved"].append({**item, "line": item["line"] + offset, "page": section["page"]})
            for entity in page_result["entities"]:
                entities[(entity["text"], entity["type"])] = entity
            result["warnings"].extend(page_result["warnings"])
        offset += len(section["text"].split("\n")) + 1
    if len(result["records"]) > 10_000:
        raise ValueError("More than 10,000 relationships extracted. Split the PDF.")
    result["entities"] = list(entities.values())
    result["source_file"] = {key: value for key, value in meta.items() if key != "sections"}
    result["source_file"]["name"] = filename
    result["warnings"] = list(dict.fromkeys(result["warnings"]))
    result["warnings"].append("PDF line wraps were joined within each page. Source rows refer to the extracted text; source page numbers identify the original PDF pages. Review reading order against the PDF.")
    if meta["empty_pages"]:
        result["warnings"].append("Pages without selectable text were not analyzed: " + ", ".join(map(str, meta["empty_pages"])) + ". Run OCR on those pages.")
    return result
