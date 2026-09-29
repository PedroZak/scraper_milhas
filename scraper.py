#!/usr/bin/env python3
"""Coleta promoções de milhas via RSS e mantém o promocoes.json atualizado.

Foco: ecossistema C6 Bank (Átomos), Livelo, Smiles e Uber/Uber One.
Campanhas exclusivas de Itaú, Azul, Latam e Esfera são descartadas.
"""
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import pandas as pd
import requests
from bs4 import BeautifulSoup

DATA_FILE = Path(__file__).resolve().parent / "promocoes.json"
MAX_RECORDS = 50
TIMEOUT = 20
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
}

FEEDS = {
    "Passageiro de Primeira": "https://passageirodeprimeira.com/feed/",
    "Melhores Destinos": "https://www.melhoresdestinos.com.br/feed",
    "Pontos pra Voar": "https://pontospravoar.com/feed/",
}

KEYWORDS = ["Livelo", "Smiles", "C6", "Átomos", "Uber", "Bônus", "Transferência", "Compra de Pontos"]
# Programas de interesse: mesmo que citem um programa excluído, a oferta é mantida.
FOCUS = ["Livelo", "Smiles", "C6", "Átomos", "Uber"]
EXCLUDED = ["Itaú", "Azul", "Latam", "Esfera"]

COLUMNS = ["titulo", "link", "data", "fonte"]


def normalize(text: str) -> str:
    """Minúsculas e sem acentos, para casar 'Átomos' com 'atomos'."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def build_regex(words: list[str]) -> str:
    # Fronteira de palavra evita falsos positivos (ex.: "Uber" em "Uberlândia").
    alternatives = "|".join(re.escape(normalize(w)) for w in words)
    return rf"\b(?:{alternatives})s?\b"


KEYWORD_RE = build_regex(KEYWORDS)
FOCUS_RE = build_regex(FOCUS)
EXCLUDED_RE = build_regex(EXCLUDED)


def clean_title(raw: str) -> str:
    return BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)


def fetch_feed(source: str, url: str) -> list[dict]:
    response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    parsed = feedparser.parse(response.content)

    now = datetime.now(timezone.utc)
    rows = []
    for entry in parsed.entries:
        title = clean_title(entry.get("title", ""))
        link = entry.get("link", "").strip()
        if not title or not link:
            continue
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        date = datetime(*published[:6], tzinfo=timezone.utc) if published else now
        rows.append(
            {
                "titulo": title,
                "link": link,
                "data": date.isoformat(timespec="seconds"),
                "fonte": source,
            }
        )
    return rows


def filter_relevant(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    normalized = df["titulo"].map(normalize)
    has_keyword = normalized.str.contains(KEYWORD_RE, regex=True)
    has_focus = normalized.str.contains(FOCUS_RE, regex=True)
    has_excluded = normalized.str.contains(EXCLUDED_RE, regex=True)
    return df[has_keyword & ~(has_excluded & ~has_focus)]


def load_existing() -> pd.DataFrame:
    if not DATA_FILE.exists():
        return pd.DataFrame(columns=COLUMNS)
    try:
        records = json.loads(DATA_FILE.read_text(encoding="utf-8") or "[]")
    except json.JSONDecodeError:
        print(f"AVISO: {DATA_FILE.name} inválido; será recriado.", file=sys.stderr)
        return pd.DataFrame(columns=COLUMNS)
    return pd.DataFrame(records, columns=COLUMNS)


def merge(existing: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    combined = pd.concat([existing, new], ignore_index=True)
    # Registros já salvos vêm primeiro, então prevalecem em caso de link repetido.
    combined = combined.drop_duplicates(subset="link", keep="first")
    combined = combined.assign(_ts=pd.to_datetime(combined["data"], utc=True, errors="coerce"))
    combined = combined.sort_values("_ts", ascending=False, kind="stable", na_position="last")
    return combined.head(MAX_RECORDS)[COLUMNS]


def main() -> int:
    collected, failures = [], 0
    for source, url in FEEDS.items():
        try:
            rows = fetch_feed(source, url)
            print(f"{source}: {len(rows)} itens no feed")
            collected.extend(rows)
        except Exception as exc:  # um feed fora do ar não deve derrubar os outros
            failures += 1
            print(f"ERRO ao ler {source}: {exc}", file=sys.stderr)

    if failures == len(FEEDS):
        print("Todos os feeds falharam; nada foi alterado.", file=sys.stderr)
        return 1

    new = filter_relevant(pd.DataFrame(collected, columns=COLUMNS))
    print(f"{len(new)} itens relevantes após o filtro")

    existing = load_existing()
    result = merge(existing, new)

    output = json.dumps(result.to_dict("records"), ensure_ascii=False, indent=2) + "\n"
    current = DATA_FILE.read_text(encoding="utf-8") if DATA_FILE.exists() else ""
    if output != current:
        DATA_FILE.write_text(output, encoding="utf-8", newline="\n")
        print(f"{DATA_FILE.name} atualizado ({len(result)} registros)")
    else:
        print("Sem mudanças.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
