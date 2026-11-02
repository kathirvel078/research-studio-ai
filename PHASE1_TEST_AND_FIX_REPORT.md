# Phase 1 Test and Fix Report

## Overall result

**PASS.** Research Studio AI Phase 1 is verified and ready for local use for its supported workflows: PDF, text, and Markdown source ingestion, local SQLite persistence, sentence-aware chunking, local extractive retrieval, citation inspection, multi-source restrictions, and cascade deletion.

All tests were executed on 2026-11-02 using fresh temporary directories and synthetic content; no user source data in `backend/data` or external AI service was touched.

## Test execution summary

| Test suite | Command | Initial result | Final result |
|---|---|---|---|
| Backend API/unit tests | `.\.venv\Scripts\python.exe -m pytest -v` | PASS: 7 passed | PASS: 10 passed |
| Python dependency consistency | `python -m pip --python .venv check` | PASS | PASS |
| Frontend unit/component tests | `npm run test -- --run` | FAIL (included e2e spec) | PASS: 3 passed |
| Frontend type check / production build | `npm run build` | PASS | PASS |
| Frontend security audit | `npm audit --omit=dev` | PASS: 0 vulnerabilities | PASS: 0 vulnerabilities |
| Browser End-to-End Suite | `npm run e2e` | FAIL (2 failed, 3 passed) | PASS: 6 passed |

## Defects identified and fixed

| Defect | Root cause | Fix applied | Regression test |
|---|---|---|---|
| **Vitest discovery picked up Playwright E2E spec** | `vite.config.ts` lacked an explicit test exclusion for the `e2e/` directory, causing Vitest to load `e2e/workspace.spec.ts` and throw Playwright hook errors | Updated `frontend/vite.config.ts` with `exclude: [...configDefaults.exclude, "e2e/**"]` | `npm run test -- --run` executes only component tests (3 passed) |
| **Inverted console error assertions in E2E tests** | `workspace.spec.ts` expected HTTP 415/422 console errors in the valid-upload test, and expected zero console errors in the test deliberately triggering 415/422 | Swapped the expectations in `frontend/e2e/workspace.spec.ts` to match the actual HTTP operations | `npm run e2e` tests 2 & 3 pass |
| **Gaps in automated backend coverage** | Pytest lacked tests for Markdown ingestion, 15MB upload limits, multi-source fact isolation, and cascade file cleanup on delete | Added 3 comprehensive tests in `backend/tests/test_api.py` | Pytest suite now runs 10 tests and passes 10/10 |
| **Missing automated 17-step integration scenario** | E2E suite had separate unit cases but no combined full lifecycle test | Added test 6 in `workspace.spec.ts` testing PDF + text + transcript, query, citation click, source restriction, reload persistence, and deletion | Playwright test 6 passes |

## Verified workflows

- **PDF Ingestion**: Ingests multi-page PDFs, preserving exact page number metadata for citations.
- **Validation**: Empty PDFs, scanned PDFs (no text layer), non-UTF-8 files, unsupported extensions (`.exe`), oversized files (>15MB), and whitespace-only manual transcripts are rejected with appropriate HTTP status codes (413, 415, 422).
- **Extractive Retrieval**: Deterministic TF-IDF ranking with stop-word removal and CJK n-gram indexing.
- **Source Restrictions**: When asking about a fact contained only in an unselected source, the system returns `insufficient_evidence` with zero fabricated citations.
- **Persistence & Deletion**: SQLite `sources` and `chunks` survive server restarts. Calling `DELETE /api/sources/{id}` removes records and unlinks the file from disk.
- **Browser Responsiveness**: Playwright verified layout responsiveness down to 390px mobile viewport width.

## Limitations

- Scanned PDFs require OCR (not included in Phase 1).
- Retrieval uses local TF-IDF matching, not semantic embeddings.
- YouTube, podcasts, audio, and remote generative LLMs are planned for later phases.
