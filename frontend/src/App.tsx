import { ChangeEvent, DragEvent, FormEvent, useEffect, useState } from "react";
import { api } from "./api";
import type { Answer, Citation, Source, SourceDetail } from "./types";

const kindLabel = (kind: string) =>
  kind === "pdf" ? "PDF" : kind === "transcript" ? "Transcript" : "Text";
export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualText, setManualText] = useState("");
  const refresh = async () => {
    try {
      setSources(await api.sources());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const choose = async (source: Source) => {
    setDetail(await api.detail(source.id));
    setSelected((ids) =>
      ids.includes(source.id)
        ? ids.filter((id) => id !== source.id)
        : [...ids, source.id],
    );
  };
  const ingest = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const source = await api.upload(file);
      await refresh();
      setSelected((ids) => [...ids, source.id]);
      setDetail(await api.detail(source.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await ingest(file);
    event.target.value = "";
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void ingest(file);
  };
  const addManual = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const source = await api.manual(manualName, manualText);
      await refresh();
      setSelected((ids) => [...ids, source.id]);
      setDetail(await api.detail(source.id));
      setManualOpen(false);
      setManualName("");
      setManualText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      setAnswer(await api.ask(question, selected));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = (citation: Citation) => {
    void api
      .detail(citation.source_id)
      .then(setDetail)
      .catch((e) => setError(e.message));
  };
  const remove = async () => {
    if (!detail) return;
    await api.remove(detail.id);
    setSelected((ids) => ids.filter((id) => id !== detail.id));
    setDetail(null);
    setAnswer(null);
    await refresh();
  };
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>✦</span>
          <div>
            Research Studio <small>AI · Local-first</small>
          </div>
        </div>
        <button className="primary" onClick={() => setManualOpen(true)}>
          + New transcript
        </button>
        <label className="upload">
          Upload a source
          <input
            aria-label="Upload PDF or text source"
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            onChange={upload}
          />
        </label>
        <p className="privacy">
          Your files stay on this device. No remote AI provider is enabled.
        </p>
        <div className="library-head">
          <span>Research library</span>
          <b>{sources.length}</b>
        </div>
        <div className="source-list">
          {sources.length === 0 ? (
            <p className="muted">Your sources will appear here.</p>
          ) : (
            sources.map((source) => (
              <button
                className={`source ${selected.includes(source.id) ? "selected" : ""}`}
                key={source.id}
                onClick={() => void choose(source)}
              >
                <span className="source-icon">
                  {source.kind === "pdf" ? "▧" : "≡"}
                </span>
                <span>
                  <strong>{source.name}</strong>
                  <small>
                    {kindLabel(source.kind)} · {source.chunk_count} passage
                    {source.chunk_count === 1 ? "" : "s"}
                  </small>
                </span>
                {selected.includes(source.id) && <i>✓</i>}
              </button>
            ))
          )}
        </div>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">SOURCE-GROUNDED RESEARCH</p>
            <h1>
              {sources.length
                ? "Research workspace"
                : "Build your source library"}
            </h1>
          </div>
          <span className="status">
            <i></i> Local processing
          </span>
        </header>
        {error && (
          <div role="alert" className="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {busy && (
          <div className="progress">
            <span></span> Processing your request…
          </div>
        )}
        {sources.length === 0 ? (
          <section
            className="empty"
            onDragOver={(event) => event.preventDefault()}
            onDrop={drop}
          >
            <div className="empty-icon">⌁</div>
            <h2>Start with evidence, not guesses.</h2>
            <p>
              Drop a PDF or text file here, upload one, or add a transcript.
              Research Studio preserves passages and locations for every answer.
            </p>
            <label className="primary big">
              Add your first source
              <input
                aria-label="Add first source"
                type="file"
                accept=".pdf,.txt,.md"
                onChange={upload}
              />
            </label>
          </section>
        ) : (
          <>
            <section className="selection">
              <span>
                {selected.length} source{selected.length === 1 ? "" : "s"}{" "}
                selected
              </span>
              <p>
                Answers are limited to the selected sources and include
                inspectable citations.
              </p>
            </section>
            <section className="chat">
              <div className="chat-label">Ask your research library</div>
              {answer ? (
                <article className="answer">
                  <p className="answer-mode">
                    {answer.evidence_status === "insufficient_evidence"
                      ? "Evidence check"
                      : "Retrieved evidence"}
                  </p>
                  <pre>{answer.answer}</pre>
                  {answer.citations.length > 0 && (
                    <div className="citations">
                      <h3>Supporting passages</h3>
                      {answer.citations.map((citation, index) => (
                        <button
                          key={citation.chunk_id}
                          onClick={() => inspect(citation)}
                        >
                          [{index + 1}] {citation.source_name}
                          {citation.page_number
                            ? ` · p. ${citation.page_number}`
                            : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ) : (
                <div className="prompt">
                  <h2>What would you like to understand?</h2>
                  <p>
                    Choose sources in the library, then ask a focused question.
                  </p>
                </div>
              )}
              <form onSubmit={ask}>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    selected.length
                      ? "Ask a question about the selected sources…"
                      : "Select one or more sources to begin"
                  }
                  disabled={!selected.length || busy}
                />
                <button
                  className="primary"
                  disabled={!selected.length || !question.trim() || busy}
                >
                  Ask →
                </button>
              </form>
            </section>
          </>
        )}
      </section>
      <aside className="context">
        <div className="context-title">Source context</div>
        {detail ? (
          <>
            <div className="context-name">
              <span>{detail.kind === "pdf" ? "▧" : "≡"}</span>
              <div>
                <strong>{detail.name}</strong>
                <small>
                  {detail.content_length.toLocaleString()} characters
                </small>
              </div>
            </div>
            <button className="danger" onClick={() => void remove()}>
              Remove source
            </button>
            <h3>Passages</h3>
            <div className="passages">
              {detail.chunks.map((chunk) => (
                <article key={chunk.chunk_id}>
                  <small>
                    {chunk.page_number
                      ? `PAGE ${chunk.page_number}`
                      : "TRANSCRIPT / TEXT"}
                  </small>
                  <p>{chunk.excerpt}</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="context-empty">
            <span>⌁</span>
            <p>Select a source or citation to inspect its original passages.</p>
          </div>
        )}
      </aside>
      {manualOpen && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={addManual}>
            <button
              type="button"
              className="close"
              aria-label="Close transcript dialog"
              onClick={() => setManualOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">MANUAL TRANSCRIPT</p>
            <h2>Add source text</h2>
            <label>
              Source name
              <input
                required
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Interview transcript"
              />
            </label>
            <label>
              Text
              <textarea
                required
                className="text-entry"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Paste a transcript or research notes…"
              />
            </label>
            <button className="primary" disabled={busy}>
              Save source
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
