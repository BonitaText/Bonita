import spacy
import re
import hashlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

nlp_general = spacy.load("en_core_web_sm")

try:
    nlp_sci = spacy.load("en_core_sci_sm", disable=["tagger", "parser", "lemmatizer", "attribute_ruler"])
except OSError:
    nlp_sci = None


def split_sentences(text: str) -> list[str]:
    doc = nlp_general(text)
    return [sent.text.strip() for sent in doc.sents]


def is_abbreviation(text: str) -> bool:
    return bool(re.match(r'^[A-Z][A-Z0-9]{1,}$', text))


def is_camel_case(text: str) -> bool:
    return bool(re.search(r'[a-z][A-Z]|[A-Z]{2,}[a-z]', text)) and len(text) >= 4


def count_syllables(word: str) -> int:
    word = word.lower().strip(".,!?")
    vowels = "aeiouy"
    count = 0
    prev_vowel = False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    return max(1, count)


def flesch_score(text: str) -> float:
    sentences = split_sentences(text)
    words = text.split()
    syllables = sum(count_syllables(w) for w in words)
    if not sentences or not words:
        return 0.0
    score = (
        206.835
        - 1.015 * (len(words) / len(sentences))
        - 84.6 * (syllables / len(words))
    )
    return round(max(0.0, min(100.0, score)), 2)


# ---------------------------------------------------------------------------
# All three extraction functions now accept pre-parsed spaCy docs
# ---------------------------------------------------------------------------

def extract_keywords_from_docs(
    general_docs: list,
    sci_docs: list,
    max_terms: int = 20,
) -> list[str]:
    priority_terms: list[str] = []
    all_candidates: list[str] = []

    for doc in general_docs:
        for ent in doc.ents:
            all_candidates.append(ent.text.lower())
        for chunk in doc.noun_chunks:
            if len(chunk.text.split()) > 1:
                all_candidates.append(chunk.text.lower())
        for token in doc:
            if token.is_stop or token.is_punct or token.is_space:
                continue
            if is_abbreviation(token.text) or is_camel_case(token.text):
                key = token.text.lower()
                if key not in priority_terms:
                    priority_terms.append(key)
                continue
            if token.pos_ == "PROPN" and len(token.text) >= 3:
                all_candidates.append(token.text.lower())
            elif token.pos_ == "NOUN" and len(token.text) >= 6:
                all_candidates.append(token.text.lower())

    for doc in sci_docs:
        for ent in doc.ents:
            key = ent.text.lower()
            if len(ent.text.split()) > 1:
                if key not in priority_terms:
                    priority_terms.append(key)
            else:
                all_candidates.append(key)

    counts = Counter(all_candidates)
    freq_terms = [word for word, _ in counts.most_common(max_terms * 2)]

    seen: set[str] = set()
    result: list[str] = []
    for term in priority_terms + freq_terms:
        if term not in seen:
            seen.add(term)
            result.append(term)
    return result


def extract_complex_words_from_docs(general_docs: list) -> list[str]:
    all_candidates = []
    for doc in general_docs:
        for token in doc:
            if (not token.is_stop
                    and not token.is_punct
                    and not token.is_space
                    and len(token.text) >= 8
                    and token.pos_ in {"NOUN", "PROPN", "ADJ", "VERB"}):
                all_candidates.append(token.text.lower())
    counts = Counter(all_candidates)
    return [word for word, count in counts.items() if count <= 2]


def paragraph_complexity_from_doc(doc, original_text: str) -> dict:
    """Complexity profile using a pre-parsed spaCy doc — no re-parsing."""
    sentences = [sent.text.strip() for sent in doc.sents]
    words = original_text.split()

    if not words or not sentences:
        return {"score": 100.0, "action": "none", "flesch": 100.0,
                "avg_word_len": 0.0, "avg_sent_len": 0.0}

    syllables = sum(count_syllables(w) for w in words)
    fk = round(max(0.0, min(100.0,
        206.835
        - 1.015 * (len(words) / len(sentences))
        - 84.6 * (syllables / len(words))
    )), 2)

    avg_word_len = sum(len(w.strip('.,!?()')) for w in words) / len(words)
    avg_sent_len = len(words) / len(sentences)
    syllable_density = syllables / len(words)

    score = fk
    if avg_word_len > 6:
        score -= (avg_word_len - 6) * 4
    if avg_sent_len > 20:
        score -= (avg_sent_len - 20) * 1.5
    if syllable_density > 2:
        score -= (syllable_density - 2) * 8
    score = round(max(0.0, min(100.0, score)), 2)

    return {
        "score": score,
        "action": "llm" if score < 40 else "split" if score < 60 else "none",
        "flesch": fk,
        "avg_word_len": round(avg_word_len, 2),
        "avg_sent_len": round(avg_sent_len, 2),
    }


# Keep old signatures intact for the PDF route which calls them directly
def extract_keywords(text: str, max_terms: int = 3) -> list[str]:
    doc = nlp_general(text)
    candidates = []
    for token in doc:
        if (not token.is_stop and not token.is_punct and not token.is_space
                and token.pos_ in {"NOUN", "PROPN", "VERB"} and len(token.text) >= 6):
            candidates.append(token.text.lower())
    return [word for word, _ in Counter(candidates).most_common(max_terms)]


def extract_keywords_per_paragraph(paragraphs: list[str], max_terms: int = 20) -> list[str]:
    """Legacy wrapper — still works but used only if you call it directly."""
    with ThreadPoolExecutor(max_workers=2) as ex:
        general_docs = ex.submit(lambda: list(nlp_general.pipe(paragraphs, batch_size=16))).result()
        sci_docs = ex.submit(lambda: list(nlp_sci.pipe(paragraphs, batch_size=16)) if nlp_sci else []).result()
    return extract_keywords_from_docs(general_docs, sci_docs, max_terms)


def extract_complex_words(paragraphs: list[str]) -> list[str]:
    """Legacy wrapper."""
    docs = list(nlp_general.pipe(paragraphs, batch_size=16))
    return extract_complex_words_from_docs(docs)