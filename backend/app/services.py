from __future__ import annotations

import math
import re
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

from .database import Database
from .schemas import Citation, SourceDetail, SourceSummary

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
TOKEN = re.compile(r"[^\W_][\w'-]*", re.UNICODE)
CJK_RUN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+")
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "that", "the", "this", "to", "what", "when", "where",
    "which", "who", "with", "would", "you", "your",
}


def now() -> str:
    return datetime.now(UTC).isoformat()


def words(text: str) -> list[str]:
    tokens = [token.lower() for token in TOKEN.findall(text) if token.lower() not in STOP_WORDS]
    # CJK writing has no reliable whitespace word boundaries. Index short
    # character n-grams so a supplied concept can match its source passage.
    for run in CJK_RUN.findall(text):
        for size in range(1, min(4, len(run)) + 1):
            tokens.extend(run[index:index + size] for index in range(len(run) - size + 1))
    return tokens


def chunk_pages(pages: list[tuple[int | None, str]]) -> list[tuple[str, int | None]]:
    chunks: list[tuple[str, int | None]] = []
    for page, text in pages:
        normalized = " ".join(text.split())
        if not normalized:
            continue
        sentences = re.split(r"(?<=[.!?])\s+", normalized)
        buffer: list[str] = []
        count = 0
        for sentence in sentences:
            length = len(words(sentence))
            if buffer and count + length > 180:
                chunks.append((" ".join(buffer), page))
                buffer, count = [], 0
            buffer.append(sentence)
            count += length
        if buffer:
            chunks.append((" ".join(buffer), page))
    return chunks


class SourceService:
    def __init__(self, database: Database):
        self.db = database

    def _summary(self, row) -> SourceSummary:
        with self.db.connect() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM chunks WHERE source_id = ?", (row["id"],)
            ).fetchone()[0]
        return SourceSummary(**dict(row), chunk_count=count)

    def list_sources(self) -> list[SourceSummary]:
        with self.db.connect() as connection:
            rows = connection.execute("SELECT * FROM sources ORDER BY created_at DESC").fetchall()
        return [self._summary(row) for row in rows]

    def get_source(self, source_id: str) -> SourceDetail:
        with self.db.connect() as connection:
            row = connection.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
            chunks = connection.execute(
                "SELECT id, content, page_number FROM chunks WHERE source_id = ? ORDER BY position",
                (source_id,),
            ).fetchall()
        if row is None:
            raise HTTPException(404, "Source not found")
        summary = self._summary(row)
        return SourceDetail(
            **summary.model_dump(),
            chunks=[
                Citation(
                    chunk_id=chunk["id"], source_id=source_id, source_name=row["name"],
                    excerpt=chunk["content"], page_number=chunk["page_number"],
                ) for chunk in chunks
            ],
        )

    def _save(self, name: str, kind: str, pages: list[tuple[int | None, str]], original: Path | None = None) -> SourceSummary:
        chunks = chunk_pages(pages)
        content_length = sum(len(text) for _, text in pages)
        if not chunks:
            raise HTTPException(422, "No readable text was found. Scanned PDFs require OCR, which is not available in Phase 1.")
        source_id = str(uuid.uuid4())
        with self.db.connect() as connection:
            connection.execute(
                "INSERT INTO sources VALUES (?, ?, ?, 'ready', ?, ?, ?, NULL)",
                (source_id, name, kind, str(original) if original else None, now(), content_length),
            )
            connection.executemany(
                "INSERT INTO chunks VALUES (?, ?, ?, ?, ?)",
                [(str(uuid.uuid4()), source_id, content, page, position) for position, (content, page) in enumerate(chunks)],
            )
        return self.get_source(source_id).model_copy(update={"chunks": []})

    async def ingest_file(self, upload: UploadFile) -> SourceSummary:
        name = Path(upload.filename or "untitled").name
        suffix = Path(name).suffix.lower()
        if suffix not in {".pdf", ".txt", ".md"}:
            raise HTTPException(415, "Use a PDF, TXT, or Markdown text file.")
        destination = self.db.uploads / f"{uuid.uuid4()}-{name}"
        size = 0
        with destination.open("wb") as target:
            while block := await upload.read(1024 * 1024):
                size += len(block)
                if size > MAX_UPLOAD_BYTES:
                    target.close()
                    destination.unlink(missing_ok=True)
                    raise HTTPException(413, "Files must be 15 MB or smaller.")
                target.write(block)
        try:
            if suffix == ".pdf":
                reader = PdfReader(destination)
                pages = [(index + 1, page.extract_text() or "") for index, page in enumerate(reader.pages)]
                return self._save(name, "pdf", pages, destination)
            try:
                text = destination.read_text(encoding="utf-8")
            except UnicodeDecodeError as error:
                raise HTTPException(422, "Text files must use UTF-8 encoding.") from error
            return self._save(name, "text", [(None, text)], destination)
        except HTTPException:
            destination.unlink(missing_ok=True)
            raise
        except Exception as error:
            destination.unlink(missing_ok=True)
            raise HTTPException(422, "Could not process this file. Check that it is a readable, non-scanned PDF or UTF-8 text file.") from error

    def ingest_manual(self, name: str, content: str) -> SourceSummary:
        if not name.strip():
            raise HTTPException(422, "Provide a source name.")
        if not content.strip():
            raise HTTPException(422, "Transcript text cannot be empty.")
        return self._save(name.strip(), "transcript", [(None, content)])

    def delete(self, source_id: str) -> None:
        with self.db.connect() as connection:
            row = connection.execute("SELECT original_path FROM sources WHERE id = ?", (source_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Source not found")
            connection.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        if row["original_path"]:
            Path(row["original_path"]).unlink(missing_ok=True)

    def answer(self, question: str, source_ids: list[str]):
        unique_source_ids = list(dict.fromkeys(source_ids))
        placeholders = ",".join("?" for _ in unique_source_ids)
        with self.db.connect() as connection:
            existing_count = connection.execute(
                f"SELECT COUNT(*) FROM sources WHERE id IN ({placeholders})", unique_source_ids
            ).fetchone()[0]
            if existing_count != len(unique_source_ids):
                raise HTTPException(422, "One or more selected sources no longer exist.")
            rows = connection.execute(
                f"""SELECT chunks.id, chunks.source_id, chunks.content, chunks.page_number,
                    sources.name FROM chunks JOIN sources ON sources.id = chunks.source_id
                    WHERE chunks.source_id IN ({placeholders})""",
                unique_source_ids,
            ).fetchall()
        if not rows:
            raise HTTPException(422, "Select at least one source that has finished processing.")
        query = words(question)
        if not query:
            raise HTTPException(422, "Ask a question containing searchable words.")
        documents = [Counter(words(row["content"])) for row in rows]
        document_frequency = Counter(token for document in documents for token in document)
        scores: list[float] = []
        query_terms = set(query)
        for document in documents:
            norm = math.sqrt(sum(value * value for value in document.values())) or 1
            score = sum(
                (document[term] / norm) * math.log((len(documents) + 1) / (document_frequency[term] + 1) + 1)
                for term in query_terms
            )
            scores.append(score)
        ranked = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)
        relevant = [(index, score) for index, score in ranked[:4] if score > 0]
        if not relevant:
            return {
                "answer": "The selected sources do not establish an answer to this question. Try different terms or add a more relevant source.",
                "evidence_status": "insufficient_evidence", "citations": [],
            }
        citations = [Citation(
            chunk_id=rows[index]["id"], source_id=rows[index]["source_id"], source_name=rows[index]["name"],
            excerpt=rows[index]["content"], page_number=rows[index]["page_number"], relevance=round(score, 3),
        ) for index, score in relevant]
        excerpts = "\n\n".join(f"[{position + 1}] {citation.excerpt}" for position, citation in enumerate(citations))
        return {
            "answer": "Local evidence retrieval found the following relevant passages. This extractive response does not add facts beyond the selected sources:\n\n" + excerpts,
            "evidence_status": "grounded_extract", "citations": citations,
        }
