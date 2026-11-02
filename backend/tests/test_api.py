from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import create_app


def client(tmp_path):
    return TestClient(create_app(tmp_path / "data"))


def text_pdf(*pages: str) -> bytes:
    """Build a tiny PDF fixture with visible text on each page."""
    font_object = 3 + len(pages) * 2
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{3 + index * 2} 0 R' for index in range(len(pages)))}] /Count {len(pages)} >>".encode(),
    ]
    for index, text in enumerate(pages):
        page_object = 3 + index * 2
        content_object = page_object + 1
        stream = f"BT /F1 14 Tf 20 100 Td ({text}) Tj ET".encode()
        objects.extend([
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 {font_object} 0 R >> >> /Contents {content_object} 0 R >>".encode(),
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        ])
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    payload = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, content in enumerate(objects, 1):
        offsets.append(len(payload))
        payload.extend(f"{number} 0 obj\n".encode() + content + b"\nendobj\n")
    xref = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    payload.extend(b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:]))
    payload.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return bytes(payload)


def test_ingests_text_and_returns_grounded_citation(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/sources/manual", json={"name": "Notes", "content": "Solar panels convert sunlight into electricity. Silicon is commonly used in panels."})
    assert created.status_code == 201
    source = created.json()
    answer = api.post("/api/ask", json={"question": "What converts sunlight into electricity?", "source_ids": [source["id"]]})
    assert answer.status_code == 200
    assert answer.json()["evidence_status"] == "grounded_extract"
    assert answer.json()["citations"][0]["source_id"] == source["id"]


def test_rejects_unsupported_files_and_reports_missing_evidence(tmp_path):
    api = client(tmp_path)
    rejected = api.post("/api/sources/upload", files={"file": ("unsafe.exe", BytesIO(b"x"), "application/octet-stream")})
    assert rejected.status_code == 415
    source = api.post("/api/sources/manual", json={"name": "Notes", "content": "The library opens at noon."}).json()
    answer = api.post("/api/ask", json={"question": "What color is the ocean?", "source_ids": [source["id"]]})
    assert answer.json()["evidence_status"] == "insufficient_evidence"


def test_uploaded_text_and_delete(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/sources/upload", files={"file": ("report.txt", BytesIO(b"Evidence is stored locally."), "text/plain")})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert api.get(f"/api/sources/{source_id}").json()["chunks"][0]["excerpt"] == "Evidence is stored locally."
    assert api.delete(f"/api/sources/{source_id}").status_code == 204
    assert api.get(f"/api/sources/{source_id}").status_code == 404


def test_pdf_text_preserves_page_number(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/sources/upload", files={"file": ("evidence.pdf", BytesIO(text_pdf("PDF evidence stays local.", "Second page evidence.")), "application/pdf")})
    assert created.status_code == 201
    detail = api.get(f"/api/sources/{created.json()['id']}").json()
    assert detail["chunks"][0]["page_number"] == 1
    assert "PDF evidence stays local" in detail["chunks"][0]["excerpt"]
    assert detail["chunks"][1]["page_number"] == 2


def test_rejects_empty_pdf_without_creating_source(tmp_path):
    empty_pdf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(empty_pdf)
    response = client(tmp_path).post("/api/sources/upload", files={"file": ("empty.pdf", BytesIO(empty_pdf.getvalue()), "application/pdf")})
    assert response.status_code == 422


def test_rejects_whitespace_invalid_encoding_and_corrupt_pdf_without_records(tmp_path):
    api = client(tmp_path)
    assert api.post("/api/sources/manual", json={"name": "   ", "content": "notes"}).status_code == 422
    assert api.post("/api/sources/manual", json={"name": "notes", "content": "   "}).status_code == 422
    invalid_text = api.post("/api/sources/upload", files={"file": ("encoded.txt", BytesIO(b"\xff\xfe"), "text/plain")})
    assert invalid_text.status_code == 422
    corrupt_pdf = api.post("/api/sources/upload", files={"file": ("bad.pdf", BytesIO(b"not a pdf"), "application/pdf")})
    assert corrupt_pdf.status_code == 422
    assert api.get("/api/sources").json() == []


def test_unicode_retrieval_selection_validation_and_persistence(tmp_path):
    api = client(tmp_path)
    source = api.post("/api/sources/manual", json={"name": "日本語", "content": "研究室では太陽電池を評価しています。"}).json()
    answer = api.post("/api/ask", json={"question": "太陽電池", "source_ids": [source["id"]]})
    assert answer.status_code == 200
    assert answer.json()["citations"][0]["source_name"] == "日本語"
    missing = api.post("/api/ask", json={"question": "太陽電池", "source_ids": [source["id"], "missing"]})
    assert missing.status_code == 422
    restarted = client(tmp_path)
    assert restarted.get("/api/sources").json()[0]["id"] == source["id"]


def test_markdown_ingestion_and_oversized_rejection(tmp_path):
    api = client(tmp_path)
    # Markdown upload
    md_response = api.post(
        "/api/sources/upload",
        files={"file": ("guide.md", BytesIO(b"# Guide\n\nMarkdown content is indexed locally."), "text/markdown")},
    )
    assert md_response.status_code == 201
    assert md_response.json()["kind"] == "text"
    assert md_response.json()["name"] == "guide.md"

    # Oversized file (>15 MB) rejection
    big_payload = BytesIO(b"0" * (15 * 1024 * 1024 + 10))
    oversized = api.post(
        "/api/sources/upload",
        files={"file": ("huge.txt", big_payload, "text/plain")},
    )
    assert oversized.status_code == 413
    uploads_dir = tmp_path / "data" / "uploads"
    assert not any(f.name.endswith("huge.txt") for f in uploads_dir.iterdir())


def test_multi_source_distinct_facts_and_restrictions(tmp_path):
    api = client(tmp_path)
    doc_a = api.post(
        "/api/sources/manual",
        json={"name": "Doc A", "content": "The ORION calibration code is 73184."},
    ).json()
    doc_b = api.post(
        "/api/sources/manual",
        json={"name": "Doc B", "content": "The VELA inspection interval is 43 days."},
    ).json()

    # Query Doc A fact with only Doc A selected -> found
    res_a = api.post("/api/ask", json={"question": "What is the ORION calibration code?", "source_ids": [doc_a["id"]]})
    assert res_a.status_code == 200
    assert res_a.json()["evidence_status"] == "grounded_extract"
    assert "73184" in res_a.json()["answer"]
    assert res_a.json()["citations"][0]["source_id"] == doc_a["id"]

    # Query Doc A fact with only Doc B selected -> insufficient evidence
    res_b = api.post("/api/ask", json={"question": "What is the ORION calibration code?", "source_ids": [doc_b["id"]]})
    assert res_b.status_code == 200
    assert res_b.json()["evidence_status"] == "insufficient_evidence"
    assert len(res_b.json()["citations"]) == 0

    # Query Doc A fact with both selected -> grounded to Doc A
    res_both = api.post("/api/ask", json={"question": "What is the ORION calibration code?", "source_ids": [doc_a["id"], doc_b["id"]]})
    assert res_both.status_code == 200
    assert res_both.json()["evidence_status"] == "grounded_extract"
    assert res_both.json()["citations"][0]["source_id"] == doc_a["id"]

    # Query without searchable words (only punctuation/stop words)
    res_unsearchable = api.post("/api/ask", json={"question": "what is that?", "source_ids": [doc_a["id"]]})
    assert res_unsearchable.status_code == 422


def test_health_docs_and_cascade_file_removal(tmp_path):
    api = client(tmp_path)
    # Health check
    health = api.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "mode": "local-only"}

    # OpenAPI docs
    docs = api.get("/docs")
    assert docs.status_code == 200

    # File upload and disk cleanup on delete
    created = api.post(
        "/api/sources/upload",
        files={"file": ("cleanup.txt", BytesIO(b"Data will be deleted completely."), "text/plain")},
    ).json()
    source_id = created["id"]
    uploads_dir = tmp_path / "data" / "uploads"
    matching_files = list(uploads_dir.glob(f"*-cleanup.txt"))
    assert len(matching_files) == 1
    assert matching_files[0].exists()

    # Delete source
    delete_res = api.delete(f"/api/sources/{source_id}")
    assert delete_res.status_code == 204
    assert not matching_files[0].exists()

    # Restart persistence check
    reloaded = client(tmp_path)
    assert reloaded.get(f"/api/sources/{source_id}").status_code == 404

