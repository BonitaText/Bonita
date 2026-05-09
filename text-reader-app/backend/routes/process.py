from fastapi import APIRouter, UploadFile, File
from models.schemas import ProcessRequest, ProcessResponse
from services.nlp import split_sentences, extract_keywords, flesch_score
import fitz

router = APIRouter()

from collections import Counter

def extract_structured_text(doc):
    all_spans = []

    # collect all spans with position info
    for page in doc:
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

                # use the first span's properties for the whole line
                first_span = line["spans"][0]
                all_spans.append({
                    "text": line_text,
                    "size": round(first_span["size"], 1),
                    "bold": "Bold" in first_span["font"],
                    "italic": "Italic" in first_span["font"]
                })

    if not all_spans:
        return []

    # find body size dynamically
    sizes = [round(s["size"]) for s in all_spans]
    body_size = Counter(sizes).most_common(1)[0][0]

    # now group consecutive body lines into paragraphs
    structured = []
    current_paragraph = []

    for span in all_spans:
        size = round(span["size"])

        if size >= body_size + 3:
            # flush any current paragraph first
            if current_paragraph:
                structured.append({
                    "text": " ".join(current_paragraph),
                    "role": "body",
                    "bold": False,
                    "italic": False
                })
                current_paragraph = []
            structured.append({**span, "role": "heading"})

        elif size >= body_size - 1:
            current_paragraph.append(span["text"])

        else:
            # small text — flush paragraph and skip
            if current_paragraph:
                structured.append({
                    "text": " ".join(current_paragraph),
                    "role": "body",
                    "bold": False,
                    "italic": False
                })
                current_paragraph = []

    # flush any remaining paragraph
    if current_paragraph:
        structured.append({
            "text": " ".join(current_paragraph),
            "role": "body",
            "bold": False,
            "italic": False
        })

    return structured

def structured_to_plain(structured):
    # collapse to plain text for NLP processing
    return " ".join([s["text"] for s in structured if s["role"] == "body"])

@router.post("/process/pdf")
async def process_pdf(file: UploadFile = File(...)):
    contents = await file.read()
    doc = fitz.open(stream=contents, filetype="pdf")

    structured = extract_structured_text(doc)
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