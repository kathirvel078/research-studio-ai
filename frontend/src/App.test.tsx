import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const respond = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
describe("Research workspace", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond([]))); });
  it("shows the empty state before sources are added", async () => { render(<App />); expect(await screen.findByText("Start with evidence, not guesses.")).toBeInTheDocument(); });
  it("submits a multiline manual transcript to the API", async () => {
    const source = { id:"s2",name:"Interview",kind:"transcript",status:"ready",created_at:"now",content_length:20,chunk_count:1 };
    vi.mocked(fetch).mockResolvedValueOnce(respond([])).mockResolvedValueOnce(respond(source, 201)).mockResolvedValueOnce(respond([source])).mockResolvedValueOnce(respond({ ...source, chunks: [] }));
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: "+ New transcript" }));
    await user.type(screen.getByLabelText("Source name"), "Interview");
    const content = screen.getByLabelText("Text");
    expect(content.tagName).toBe("TEXTAREA");
    await user.type(content, "First line{enter}Second line");
    await user.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/api/sources/manual", expect.objectContaining({ method: "POST" })));
  });
  it("makes a selected source available to question answering", async () => { vi.mocked(fetch).mockResolvedValueOnce(respond([{ id:"s1",name:"Brief",kind:"text",status:"ready",created_at:"now",content_length:10,chunk_count:1 }])).mockResolvedValueOnce(respond({ id:"s1",name:"Brief",kind:"text",status:"ready",created_at:"now",content_length:10,chunk_count:1,chunks:[] })); render(<App />); await userEvent.click(await screen.findByText("Brief")); expect(screen.getByPlaceholderText("Ask a question about the selected sources…")).toBeEnabled(); });
});
