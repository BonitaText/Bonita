from fastapi import APIRouter, UploadFile, File
from models.schemas import ProcessRequest, ProcessResponse
from services.nlp import split_sentences, extract_keywords, flesch_score
import fitz
from . import merge_split_paragraphs
import re
router = APIRouter()
from collections import Counter
_PAGE_ARTIFACT_RE = re.compile(
    r"""^(
        \d+
        | [ivxlcIVXLC]+
        | [Pp]age\s+\d+
        | \d+\s*[/of\-–]\s*\d+
        | [\-–|·•]?\s*\d+\s*[\-–|·•]?
        | journal\s+of\b.*
        | \d+\s+journal\s+of\b.*
        | \d+\s+\w[\w\s]+at\s+a\s+glance
    )$""",
    re.VERBOSE | re.IGNORECASE,
)
def extract_structured_text(doc):
    all_lines = []

    for page_num, page in enumerate(doc):
        page_height = page.rect.height
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            
            for line in block.get("lines", []):
                line_text = " ".join(
                    span["text"].strip()
                    for span in line.get("spans", [])
                    if span["text"].strip()
                )
                if not line_text:
                    continue
                
                first_span = line["spans"][0]
                bbox = line["bbox"]
                
                if _is_page_artifact(line_text, bbox, page_height, margin=60):
                    continue
                all_lines.append({
                    "text": line_text,
                    "size": round(first_span["size"], 1),
                    "bold": "Bold" in first_span["font"],
                    "italic": "Italic" in first_span["font"],
                    "x_left": round(bbox[0], 1),
                    "page": page_num
                })
    if not all_lines:
        return []

    # body font size = most common size
    sizes = [round(l["size"]) for l in all_lines]
    body_size = Counter(sizes).most_common(1)[0][0]

    # find column margins — take the two most common x_lefts among body lines
    body_x_lefts = [l["x_left"] for l in all_lines if round(l["size"]) == body_size]
    margin_counts = Counter(body_x_lefts).most_common()
    col_margins = sorted([m[0] for m in margin_counts[:2]])
    indent_tolerance = 5

    def is_indented(x_left):
        nearest = min(col_margins, key=lambda m: abs(x_left - m))
        return x_left > nearest + indent_tolerance

    structured = []
    current_paragraph = []

    def flush_paragraph():
        if current_paragraph:
            structured.append({
                "text": " ".join(current_paragraph),
                "role": "body",
                "bold": False,
                "italic": False
            })
            current_paragraph.clear()

    for line in all_lines:
        size = round(line["size"])

        # heading
        if size >= body_size + 3:
            flush_paragraph()
            structured.append({
                "text": line["text"],
                "role": "heading",
                "bold": line["bold"],
                "italic": line["italic"],
                "size": line["size"],
                "body_size": body_size,
            })
            continue

        # caption / footnote
        if size < body_size - 1:
            flush_paragraph()
            continue

        # body line — indent means new paragraph
        if is_indented(line["x_left"]):
            flush_paragraph()

        current_paragraph.append(line["text"])

    flush_paragraph()
    return structured

def structured_to_plain(structured):
    # collapse to plain text for NLP processing
    return " ".join([s["text"] for s in structured if s["role"] == "body"])

@router.post("/process/pdf")
async def process_pdf(file: UploadFile = File(...)):
    contents = await file.read()
    doc = fitz.open(stream=contents, filetype="pdf")

    structured = extract_structured_text(doc)
    structured = merge_split_paragraphs.merge_split_paragraphs(structured)   # ← add this
    plain_text = structured_to_plain(structured)

    sentences = split_sentences(plain_text)
    keywords = extract_keywords(plain_text)
    score = flesch_score(plain_text)

    return {
        "structured": structured,
        "flesch_score": score,
        "sentences": sentences,
        "keywords": keywords
    }
def _is_page_artifact(text: str, bbox: tuple, page_height: float,
                       margin: float) -> bool:
    """True for page numbers, running headers/footers."""
    text = text.strip()
    if not text:
        return True

    x0, y0, x1, y1 = bbox

    # bbox starts within the top margin OR bottom margin
    near_top = y0 < margin
    near_bottom = y1 > (page_height - margin)
    near_edge = near_top or near_bottom

    if not near_edge:
        return False

    # In the margin zone — drop anything short
    word_count = len(text.split())
    if word_count < 15:
        return True

    if _PAGE_ARTIFACT_RE.match(text):
        return True

    return False