import spacy
import re

nlp = spacy.load("en_core_web_sm")

def split_sentences(text: str) -> list[str]:
    doc = nlp(text)
    return [sent.text.strip() for sent in doc.sents]

def extract_keywords(text: str) -> list[str]:
    doc = nlp(text)
    return list(set([chunk.text for chunk in doc.noun_chunks]))

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