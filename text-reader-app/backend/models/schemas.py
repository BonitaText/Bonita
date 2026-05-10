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

class WebpageProcessResponse(BaseModel):
    bold_targets: list[str]        # flat list of keywords to bold page-wide
    complex_words: list[str]       # words to underline + show definitions
    sentences: list[str]           # sentences for sentence splitting