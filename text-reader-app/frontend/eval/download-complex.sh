#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$(dirname "$0")/data"
mkdir -p "$DATA_DIR"

fetch_split() {
  local dataset="$1" config="$2" split="$3" outfile="$4"
  local tmp_jsonl="${outfile}.jsonl"
  : > "$tmp_jsonl"

  echo "Fetching $dataset ($split)..."
  local offset=0 length=100 total=-1

  while true; do
    resp=$(curl -sf "https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${length}")
    count=$(echo "$resp" | jq '.rows | length')
    if [ "$count" -eq 0 ]; then break; fi

    echo "$resp" | jq -c '.rows[] | {id: (.row_idx | tostring), tokens: .row.document, keyphrases: .row.extractive_keyphrases}' >> "$tmp_jsonl"

    total=$(echo "$resp" | jq '.num_rows_total')
    offset=$((offset + length))
    echo "  ...${offset}/${total}"
    if [ "$offset" -ge "$total" ]; then break; fi
  done

  jq -s '.' "$tmp_jsonl" > "$outfile"
  rm -f "$tmp_jsonl"
  echo "Wrote $(jq 'length' "$outfile") docs -> $outfile"
}

fetch_split "midas/inspec"  "generation" "test" "$DATA_DIR/inspec_test.json"
fetch_split "midas/duc2001" "generation" "test" "$DATA_DIR/duc2001_test.json"