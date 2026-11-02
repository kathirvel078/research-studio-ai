from pydantic import BaseModel, Field


class SourceSummary(BaseModel):
    id: str
    name: str
    kind: str
    status: str
    created_at: str
    content_length: int
    chunk_count: int
    error_message: str | None = None


class SourceDetail(SourceSummary):
    chunks: list["Citation"]


class ManualSourceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=2_000_000)


class Citation(BaseModel):
    chunk_id: str
    source_id: str
    source_name: str
    excerpt: str
    page_number: int | None = None
    relevance: float | None = None


class QuestionRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1_000)
    source_ids: list[str] = Field(min_length=1, max_length=50)


class AnswerResponse(BaseModel):
    answer: str
    evidence_status: str
    citations: list[Citation]
