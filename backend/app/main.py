from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .database import Database
from .schemas import AnswerResponse, ManualSourceRequest, QuestionRequest, SourceDetail, SourceSummary
from .services import SourceService


def create_app(data_dir: Path | None = None) -> FastAPI:
    root = data_dir or Path(os.environ.get("RESEARCH_STUDIO_DATA_DIR", Path(__file__).parents[1] / "data"))
    service = SourceService(Database(root))
    app = FastAPI(title="Research Studio AI", version="0.1.0")
    origins = ["http://127.0.0.1:5173", "http://localhost:5173", "https://research-studio-ai-brown.vercel.app"]
    if extra_origin := os.environ.get("RESEARCH_STUDIO_EXTRA_CORS_ORIGIN"):
        origins.append(extra_origin)
    app.add_middleware(CORSMiddleware, allow_origins=origins,allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/health")
    def health(): return {"status": "ok", "mode": "local-only"}

    @app.get("/api/sources", response_model=list[SourceSummary])
    def sources(): return service.list_sources()

    @app.post("/api/sources/upload", response_model=SourceSummary, status_code=201)
    async def upload(file: UploadFile = File(...)): return await service.ingest_file(file)

    @app.post("/api/sources/manual", response_model=SourceSummary, status_code=201)
    def manual(request: ManualSourceRequest): return service.ingest_manual(request.name, request.content)

    @app.get("/api/sources/{source_id}", response_model=SourceDetail)
    def source(source_id: str): return service.get_source(source_id)

    @app.delete("/api/sources/{source_id}", status_code=204)
    def delete(source_id: str):
        service.delete(source_id)
        return Response(status_code=204)

    @app.post("/api/ask", response_model=AnswerResponse)
    def ask(request: QuestionRequest): return service.answer(request.question, request.source_ids)

    return app


app = create_app()
