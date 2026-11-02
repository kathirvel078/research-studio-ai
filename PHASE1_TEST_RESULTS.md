# Research Studio AI — Phase 1 Test Results

## Overall result

**PASS.** All configured automated suites, browser automation checks, and local runtime checks passed on 2026-11-02. Phase 1 is verified and ready for local use for PDF, text, and Markdown ingestion, multiline manual transcripts, local SQLite persistence, sentence-aware chunking, local extractive retrieval, citations with page numbers, multi-source selection/restrictions, and cascading source deletion.

The existing `rea` repository was not modified. Live workflow checks used temporary databases and synthetic content only; existing user files in `backend/data` were preserved untouched.

## Executed checks

| Status | Check | Command / method | Actual result |
|---|---|---|---|
| PASS | Backend API and unit tests | `.\.venv\Scripts\python.exe -m pytest -v` | 10 passed, 0 failed, 0 skipped; one upstream deprecation warning. |
| PASS | Python dependencies | `python -m pip --python .venv check` | `No broken requirements found.` |
| PASS | Frontend component tests | `npm run test -- --run` | 1 test file, 3 passed, 0 failed, 0 skipped. |
| PASS | Type check and production bundle | `npm run build` | TypeScript `tsc -b` and Vite build succeeded with 0 errors. |
| PASS | Frontend security audit | `npm audit --omit=dev` | 0 vulnerabilities found. |
| PASS | Browser End-to-End Suite | `npm run e2e` | 1 test file, 6 passed, 0 failed, 0 skipped (Playwright Chromium). |
| PASS | Backend startup & health check | Uvicorn process on `127.0.0.1:8000` | `GET /api/health` returned `{"status": "ok", "mode": "local-only"}`. `GET /docs` returned HTTP 200. |
| PASS | Full E2E integration workflow | Playwright scenario with synthetic documents | Uploaded PDF ("ORION code 73184"), text ("VELA interval 43 days"), and multiline transcript ("Project Lyra"); verified citation links, source restriction (`insufficient_evidence`), UI reload persistence, and file/database deletion. |

## Verified workflows

### Automated coverage

- **PDF Ingestion & Page Tracking**: Text-bearing multi-page PDF extraction preserving exact 1-based page numbers; rejection of empty/scanned PDFs lacking a text layer with HTTP 422.
- **Text & Markdown Ingestion**: Verified `.txt` and `.md` ingestion, UTF-8 validation, and rejection of unsupported file types (`.exe`) with HTTP 415.
- **Upload Limits & Cleanup**: Rejection of files exceeding 15 MB with HTTP 413, verifying no orphaned files remain in `backend/data/uploads`.
- **Manual Transcripts**: Multiline textarea inputs accepted; whitespace-only and empty submissions rejected with HTTP 422.
- **Unicode & Multilingual Support**: Unicode tokenization and CJK character n-gram indexing (1–4 grams) verified.
- **Source Selection & Restrictions**: Distinct synthetic facts queried across multiple sources; selecting only non-matching sources returns `insufficient_evidence` without hallucinations.
- **Citation Precision**: Citations map directly to stored database chunk IDs and match stored text passages.
- **Persistence & Deletion**: Database foreign-key enforcement with `ON DELETE CASCADE`; deleting a source removes chunk records from SQLite and unlinks the file from disk. Re-initialization verifies data stays absent.

### Browser end-to-end coverage (Playwright)

- Empty workspace rendering and narrow mobile viewport responsiveness (390px width).
- Text upload, manual transcript modal submission, citation inspection drawer, and source removal.
- Server validation error alerts in the UI for unsupported uploads and empty transcripts.
- PDF file picker upload with page number badge display (`p. 1`).
- Drag-and-drop file upload to the empty-state drop zone.
- Full end-to-end workflow covering multi-source selection, question answering, citation click navigation, page refresh persistence, and source removal.

## Defects fixed during verification

| Defect | Root cause | Fix applied | Verified by |
|---|---|---|---|
| Vitest executed Playwright E2E spec | `vite.config.ts` did not exclude `e2e/**` from Vitest's test pattern | Added `exclude: [...configDefaults.exclude, "e2e/**"]` in `frontend/vite.config.ts` | `npm run test -- --run` passes (3 passed) |
| Inverted console error assertions in E2E tests | Swapped assertions between valid-upload and invalid-upload tests in `e2e/workspace.spec.ts` | Moved HTTP 415/422 expectation to the invalid-upload test and expected `[]` in the valid test | `npm run e2e` passes (6 passed) |
| Missing automated coverage for markdown, upload limits, and distinct facts | Previous pytest suite covered 7 core scenarios | Added 3 tests in `backend/tests/test_api.py` covering `.md` uploads, 15MB limit, distinct facts, and cascade deletion | `pytest` passes (10 passed) |

## Security & privacy findings

- Local-only binding on `127.0.0.1`.
- CORS restricted to local Vite origins.
- No external model, cloud embedding, or remote API calls.
- Path traversal protection via `Path(upload.filename).name` basenaming.
- Zero known vulnerabilities in production dependencies (`npm audit --omit=dev`).

## Reproduce the checks

From `C:\Users\kathi\OneDrive\Desktop\ReverseEngineering\research-studio-ai`:

```powershell
# 1. Backend tests
.\.venv\Scripts\python.exe -m pytest -v

# 2. Dependency check
python -m pip --python .venv check

# 3. Frontend tests and production build
cd frontend
npm run test -- --run
npm run build
npm audit --omit=dev

# 4. Playwright End-to-End tests
npm run e2e
```
