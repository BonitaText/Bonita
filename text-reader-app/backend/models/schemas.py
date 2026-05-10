from pydantic import BaseModel, Field
from typing import Literal

class ProcessRequest(BaseModel):
    text: str
    source: Literal["website", "pdf", "docx"] = "website"

class ProcessResponse(BaseModel):
    flesch_score: float
    sentences: list[str]
    keywords: list[str]
    source: str

class WebpageTextRequest(BaseModel):
    paragraphs: list[str]
    max_bold_terms: int = Field(default=3, ge=1)

class ParagraphScore(BaseModel):
    text: str          # first 120 chars as identifier
    score: float
    action: str        # "none" | "split" | "llm"
    flesch: float
    avg_word_len: float
    avg_sent_len: float

class WebpageProcessResponse(BaseModel):
    bold_targets: list[str]
    complex_words: list[str]
    sentences: list[str]
    paragraph_scores: list[ParagraphScore]