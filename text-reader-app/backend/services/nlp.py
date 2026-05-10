import spacy
import re
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


def extract_keywords(text: str, max_terms: int = 3) -> list[str]:
    doc = nlp_general(text)
    candidates = []
    for token in doc:
        if (not token.is_stop
            and not token.is_punct
            and not token.is_space
            and token.pos_ in {"NOUN", "PROPN", "VERB"}
            and len(token.text) >= 6):
            candidates.append(token.text.lower())
    return [word for word, _ in Counter(candidates).most_common(max_terms)]


def is_abbreviation(text: str) -> bool:
    return bool(re.match(r'^[A-Z][A-Z0-9]{1,}$', text))


def is_camel_case(text: str) -> bool:
    return bool(re.search(r'[a-z][A-Z]|[A-Z]{2,}[a-z]', text)) and len(text) >= 4


def _run_general(paragraphs: list[str]) -> list:
    return list(nlp_general.pipe(paragraphs, batch_size=16))


def _run_sci(paragraphs: list[str]) -> list:
    if not nlp_sci:
        return []
    return list(nlp_sci.pipe(paragraphs, batch_size=16))


def extract_keywords_per_paragraph(paragraphs: list[str], max_terms: int = 20) -> list[str]:
    priority_terms: list[str] = []
    all_candidates: list[str] = []

    # Run both models in parallel
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_general = ex.submit(_run_general, paragraphs)
        f_sci = ex.submit(_run_sci, paragraphs)
        general_docs = f_general.result()
        sci_docs = f_sci.result()

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


def extract_complex_words(paragraphs: list[str]) -> list[str]:
    all_candidates = []
    for doc in nlp_general.pipe(paragraphs, batch_size=16):
        for token in doc:
            if (not token.is_stop
                and not token.is_punct
                and not token.is_space
                and len(token.text) >= 8
                and token.pos_ in {"NOUN", "PROPN", "ADJ", "VERB"}):
                all_candidates.append(token.text.lower())
    counts = Counter(all_candidates)
    return [word for word, count in counts.items() if count <= 2]


def flesch_score(text: str) -> float:
    sentences = split_sentences(text)
    words = text.split()
    syllables = sum(count_syllables(w) for w in words)
    if len(sentences) == 0 or len(words) == 0:
        return 0.0
    score = (
        206.835
        - 1.015 * (len(words) / len(sentences))
        - 84.6 * (syllables / len(words))
    )
    return round(max(0.0, min(100.0, score)), 2)


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