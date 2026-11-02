# Research Studio AI

Local-first, source-grounded research workspace. Phase 1 supports PDF, text,
and manual transcript ingestion; local retrieval; and citation-backed answers.

## Privacy

Uploaded files, extracted text, chunks, and the SQLite database stay on this
machine under `backend/data` by default. Phase 1 has no remote model,
embedding, transcript, or speech provider. It sends no source content over the
network. The answer generator is deliberately extractive and reports when
selected sources do not establish an answer.

## Run locally

Open two terminals from this directory.

```powershell
# Python 3.14 on this machine needs the --without-pip workaround.
python -m venv .venv --without-pip
python -m pip --python .venv install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

```powershell
cd frontend
npm install
npm run dev
```

Open the local Vite address shown in the second terminal (normally
`http://127.0.0.1:5173`).

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
cd frontend; npm test -- --run
```

## Limitations

- Scanned PDFs need OCR and are rejected with an explicit message.
- YouTube, mind-map, podcast, remote-model, and audio support are later phases.
- Local retrieval uses TF-IDF term matching, not semantic embeddings. It is
  transparent and offline, but may miss paraphrases.
