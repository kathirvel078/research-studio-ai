from __future__ import annotations

import sqlite3
from pathlib import Path


class Database:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.uploads = self.root / "uploads"
        self.uploads.mkdir(exist_ok=True)
        self.path = self.root / "research_studio.sqlite3"
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS sources (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  status TEXT NOT NULL,
                  original_path TEXT,
                  created_at TEXT NOT NULL,
                  content_length INTEGER NOT NULL,
                  error_message TEXT
                );
                CREATE TABLE IF NOT EXISTS chunks (
                  id TEXT PRIMARY KEY,
                  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                  content TEXT NOT NULL,
                  page_number INTEGER,
                  position INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS chunks_source_id ON chunks(source_id);
                """
            )
