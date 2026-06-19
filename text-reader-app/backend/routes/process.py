from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from models.schemas import ProcessRequest, ProcessResponse, WebpageTextRequest, WebpageProcessResponse, ParagraphScore
from services.nlp import (
    split_sentences, extract_keywords, flesch_score,
    extract_keywords_from_docs, extract_complex_words_from_docs,
    paragraph_complexity_from_doc, nlp_general, nlp_sci,
)
import fitz
from . import merge_split_paragraphs
import re
import hashlib
from pydantic import BaseModel, Field
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

router = APIRouter()

# ---------------------------------------------------------------------------
# Backend response cache — keyed by hash of the paragraph list.
# Same page visited twice (or extension reopened) returns instantly.
# ---------------------------------------------------------------------------
_webpage_cache: dict[str, WebpageProcessResponse] = {}

def _paragraphs_hash(paragraphs: list[str]) -> str:
    return hashlib.md5("|".join(paragraphs).encode()).hexdigest()


class PdfParams(BaseModel):
    page_number_margin_px: float = Field(
        55.0,
        description="Height in px from top/bottom edge treated as header/footer zone."
    )
    min_paragraph_words: int = Field(
        6,
        description="Body blocks shorter than this are dropped."
    )
    column_cluster_tolerance_px: float = Field(
        20.0,
        description="x0 values within this range are considered the same column."
    )
    min_plausible_font_size: int = Field(
        7,
        description=(
            "Spans smaller than this (diagram labels, superscripts) are excluded "
            "from body-size detection and dropped from output."
        )
    )
    include_references: bool = Field(
        False,
        description="If True, keep the references/bibliography section."
    )


_PAGE_ARTIFACT_RE = re.compile(
    r"""^(
        \d+                                     # bare page number
        | [ivxlcIVXLC]+                         # roman numerals
        | [Pp]age\s+\d+                         # "Page 3"
        | \d+\s*[/of\-–]\s*\d+                 # "3 of 12", "3/12"
        | [\-–|·•]?\s*\d+\s*[\-–|·•]?          # decorated  · 3 ·
        | journal\s+of\b.*                      # "Journal of Cell Science 123 (15)"
        | \d+\s+journal\s+of\b.*               # "2528 Journal of Cell Science..."
        | \d+\s+\w[\w\s]+at\s+a\s+glance      # "2527 Cell Science at a Glance"
    )$""",
    re.VERBOSE | re.IGNORECASE,
)

_RUNNING_AUTHOR_RE = re.compile(
    r"""^(
        [A-Z][a-z]+(\s+[A-Z][a-z]+){0,2}   # 1–3 capitalised words (surname/s)
        (\s+et\s+al\.?)?                    # optional "et al" / "et al."
    )$""",
    re.VERBOSE,
)

def _is_page_artifact(text: str, bbox: tuple, page_height: float,
                       margin: float) -> bool:
    stripped = text.strip()
    if len(stripped) > 80:
        return False
    _, y0, _, y1 = bbox
    near_edge = y0 < margin or y1 > (page_height - margin)
    if not near_edge:
        return False
    return bool(_PAGE_ARTIFACT_RE.match(stripped)) or bool(_RUNNING_AUTHOR_RE.match(stripped))


_SECTION_LABEL_RE = re.compile(
    r"""^(
        abstract | background | introduction | methods? | results?
        | discussion | conclusions? | limitations? | acknowledgements?
        | acknowledgments? | references? | appendix | overview
        | ethical\s+considerations? | data\s+availability
        | conflicts?\s+of\s+interest | principal\s+findings?
    )\s*:?\s*$""",
    re.VERBOSE | re.IGNORECASE,
)

_COLON_LABEL_RE = re.compile(
    r'(?<!\w)'
    r'(Background|Objective|Methods?|Results?|Discussion|Conclusions?'
    r'|Limitations?|Introduction|Overview|Principal\s+Findings?)'
    r'\s*:\s*',
    re.IGNORECASE,
)

_EMBEDDED_HEADING_RE = re.compile(
    r'(?<=[.!?])\s+'
    r'(?P<heading>'
        r'[A-Za-z0-9][^.!?]{2,79}'
    r')'
    r'(?=\s+[A-Z][a-z])',
)


def _split_embedded_headings(structured: list[dict]) -> list[dict]:
    def _apply_colon_split(item: dict) -> list[dict]:
        parts = _COLON_LABEL_RE.split(item["text"])
        if len(parts) == 1:
            return [item]
        out: list[dict] = []
        pre = parts[0].strip()
        if pre:
            out.append({**item, "text": pre})
        i = 1
        while i < len(parts) - 1:
            label   = parts[i].strip()
            content = parts[i + 1].strip()
            if label:
                out.append({"text": label, "role": "heading", "bold": False, "italic": False})
            if content:
                out.append({**item, "text": content})
            i += 2
        return out

    def _apply_embedded_split(item: dict) -> list[dict]:
        text = item["text"]
        matches = [
            m for m in _EMBEDDED_HEADING_RE.finditer(text)
            if 3 <= len(m.group("heading").split()) <= 15
        ]
        if not matches:
            return [item]
        out: list[dict] = []
        prev_end = 0
        for m in matches:
            before = text[prev_end:m.start()].strip()
            if before:
                out.append({**item, "text": before})
            out.append({"text": m.group("heading").strip(),
                        "role": "heading", "bold": False, "italic": False})
            prev_end = m.end()
        tail = text[prev_end:].strip()
        if tail:
            out.append({**item, "text": tail})
        return out

    result: list[dict] = []
    for item in structured:
        if item["role"] != "body":
            result.append(item)
            continue
        after_a = _apply_colon_split(item)
        for sub in after_a:
            if sub["role"] == "body":
                result.extend(_apply_embedded_split(sub))
            else:
                result.append(sub)
    return result


def extract_structured_text(doc, params: PdfParams):
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
                if _is_page_artifact(line_text, bbox, page_height, params.page_number_margin_px):
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

    sizes = [
        round(l["size"]) for l in all_lines
        if round(l["size"]) >= params.min_plausible_font_size
    ]
    body_size = Counter(sizes).most_common(1)[0][0]

    body_x_lefts = [l["x_left"] for l in all_lines if round(l["size"]) == body_size]
    margin_counts = Counter(body_x_lefts).most_common()
    col_margins = sorted([m[0] for m in margin_counts[:2]])
    indent_tolerance = 5

    def is_indented(x_left):
        nearest = min(col_margins, key=lambda m: abs(x_left - m))
        return x_left > nearest + indent_tolerance

    def is_heading(line: dict) -> bool:
        size = round(line["size"])
        if size >= body_size + 3:
            return True
        if size >= body_size - 1 and line["bold"]:
            if _SECTION_LABEL_RE.match(line["text"].strip()):
                return True
        return False

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
        if is_heading(line):
            flush_paragraph()
            structured.append({
                "text": line["text"],
                "role": "heading",
                "bold": line["bold"],
                "italic": line["italic"]
            })
            continue
        if size < params.min_plausible_font_size or size < body_size - 1:
            flush_paragraph()
            continue
        if is_indented(line["x_left"]):
            flush_paragraph()
        current_paragraph.append(line["text"])

    flush_paragraph()
    return structured


def structured_to_plain(structured):
    return " ".join([s["text"] for s in structured if s["role"] == "body"])


@router.post("/process/pdf")
async def process_pdf(
    file: UploadFile = File(...),
    page_number_margin_px: float = Query(55.0),
    min_paragraph_words: int = Query(6),
    column_cluster_tolerance_px: float = Query(20.0),
    min_plausible_font_size: int = Query(7),
    include_references: bool = Query(False),
):
    contents = await file.read()
    try:
        doc = fitz.open(stream=contents, filetype="pdf")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not open PDF — the file may be corrupt or truncated: {exc}"
        )
    params = PdfParams(
        page_number_margin_px=page_number_margin_px,
        min_paragraph_words=min_paragraph_words,
        column_cluster_tolerance_px=column_cluster_tolerance_px,
        min_plausible_font_size=min_plausible_font_size,
        include_references=include_references,
    )
    structured = extract_structured_text(doc, params)
    structured = _split_embedded_headings(structured)
    structured = merge_split_paragraphs.merge_split_paragraphs(structured)
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


@router.post("/process/webpage", response_model=WebpageProcessResponse)
async def process_webpage(body: WebpageTextRequest):
    if not body.paragraphs:
        raise HTTPException(status_code=400, detail="No paragraphs provided.")

    filtered = [p.strip() for p in body.paragraphs if len(p.strip().split()) >= 18]
    if not filtered:
        raise HTTPException(status_code=400, detail="No paragraphs long enough to process.")

    # Return cached result if we've seen this exact page before
    cache_key = _paragraphs_hash(filtered)
    if cache_key in _webpage_cache:
        return _webpage_cache[cache_key]

    # Single parallel spaCy pass — replaces the N+3 individual nlp() calls
    def run_general() -> list:
        return list(nlp_general.pipe(filtered, batch_size=16))

    def run_sci() -> list:
        return list(nlp_sci.pipe(filtered, batch_size=16)) if nlp_sci else []

    with ThreadPoolExecutor(max_workers=2) as ex:
        general_docs = ex.submit(run_general).result()
        sci_docs     = ex.submit(run_sci).result()

    # Everything derived from the same pre-parsed docs — no re-running spaCy
    bold_targets  = extract_keywords_from_docs(general_docs, sci_docs, max_terms=body.max_bold_terms)
    complex_words = extract_complex_words_from_docs(general_docs)
    sentences     = [sent.text.strip() for doc in general_docs for sent in doc.sents]

    paragraph_scores = [
        ParagraphScore(
            text=filtered[i][:120],
            **paragraph_complexity_from_doc(doc, filtered[i]),
        )
        for i, doc in enumerate(general_docs)
    ]

    result = WebpageProcessResponse(
        bold_targets=bold_targets,
        complex_words=complex_words,
        sentences=sentences,
        paragraph_scores=paragraph_scores,
    )

    _webpage_cache[cache_key] = result
    return result