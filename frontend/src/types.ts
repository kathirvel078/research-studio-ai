export type Source = { id: string; name: string; kind: string; status: string; created_at: string; content_length: number; chunk_count: number; error_message?: string };
export type Citation = { chunk_id: string; source_id: string; source_name: string; excerpt: string; page_number?: number; relevance?: number };
export type SourceDetail = Source & { chunks: Citation[] };
export type Answer = { answer: string; evidence_status: string; citations: Citation[] };
