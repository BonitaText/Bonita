from pydantic import BaseModel

class ProcessRequest(BaseModel):
    text: str
    url: str | None = None

class ProcessResponse(BaseModel):
    sentences: list[str]
    keywords: list[str]
    flesch_score: float
    tldr: list[str] | None = None