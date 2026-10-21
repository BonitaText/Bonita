"""
eval/run_yake.py

Runs the reference YAKE implementation over the same documents your TS eval
uses and writes ranked keyphrases to eval/data/yake_predictions.json, which
runKeyphraseEval.ts loads automatically.

Setup (once):
    pip install yake

Run (from the frontend/ folder):
    python eval/run_yake.py
"""

import json
import pathlib

import yake

DATA = pathlib.Path(__file__).parent / "data"
DATASETS = ["inspec_test", "duc2001_test"]  # file stems in eval/data/

out = {}
for name in DATASETS:
    path = DATA / f"{name}.json"
    if not path.exists():
        print(f"skip {name}: {path} not found")
        continue

    docs = json.load(open(path, encoding="utf-8"))
    out[name] = {}

    # n=1 -> unigrams only. n=3 -> phrases up to 3 words (may also return shorter ones).
    for n in (1, 3):
        extractor = yake.KeywordExtractor(lan="en", n=n, top=30, dedupLim=0.9)
        preds = {}
        for d in docs:
            text = " ".join(d["tokens"])  # identical input to the TS scripts
            kws = extractor.extract_keywords(text)  # list of (phrase, score)
            # YAKE: LOWER score = better keyword, so sort ascending.
            preds[str(d["id"])] = [kw for kw, _ in sorted(kws, key=lambda x: x[1])]
        out[name][f"yake_n{n}"] = preds
        print(f"{name}: yake_n{n} done ({len(preds)} docs)")

json.dump(out, open(DATA / "yake_predictions.json", "w", encoding="utf-8"))
print("wrote", DATA / "yake_predictions.json")