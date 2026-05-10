import re

# things that count as a sentence ending
_TERMINAL_PUNCT = re.compile(r'[.!?:]["\'\)\]]?\s*$')

# common abbreviations that end with a period but aren't sentence ends
_ABBREVIATIONS = {
    "e.g.", "i.e.", "etc.", "cf.", "vs.", "viz.", "et al.",
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "St.", "Fig.", "Eq.",
    "No.", "Vol.", "pp.", "Ref.", "Refs.",
}

def _ends_with_terminal_punctuation(text: str) -> bool:
    """True if text appears to end at a real sentence boundary."""
    text = text.rstrip()
    if not text:
        return False

    # check for abbreviation ending — e.g., "Smith et al."
    last_word = text.split()[-1]
    if last_word in _ABBREVIATIONS:
        return False

    return bool(_TERMINAL_PUNCT.search(text))


def _starts_lowercase(text: str) -> bool:
    """True if the first alphabetic character is lowercase."""
    for ch in text.lstrip():
        if ch.isalpha():
            return ch.islower()
    return False


def merge_split_paragraphs(structured: list[dict]) -> list[dict]:
    """
    Merge consecutive body paragraphs when the first ends mid-sentence
    (no terminal punctuation) AND the next begins with a lowercase letter,
    indicating the sentence genuinely continues across a paragraph boundary.

    Headings and captions act as hard barriers — never merged into or across them.

    FIX 3: The original condition used `or not _ends_with_terminal_punctuation(...)`
    as a second branch, which is always true when the first branch is true, causing
    nearly every pair of body paragraphs to merge regardless of whether the second
    one starts mid-sentence.  The corrected logic requires BOTH conditions:
      - previous paragraph ends without terminal punctuation  (mid-sentence break)
      - current paragraph starts with a lowercase letter       (continuation signal)
    """
    if not structured:
        return structured

    merged: list[dict] = []

    for item in structured:
        # headings/captions are barriers — never merge into or across them
        if item["role"] != "body":
            merged.append(item)
            continue

        # Merge only when the previous body block clearly ends mid-sentence
        # AND this block clearly continues it (lowercase start).
        if (
            merged
            and merged[-1]["role"] == "body"
            and not _ends_with_terminal_punctuation(merged[-1]["text"])
            and _starts_lowercase(item["text"])
        ):
            # merge into previous
            merged[-1] = {
                **merged[-1],
                "text": merged[-1]["text"].rstrip() + " " + item["text"].lstrip(),
            }
        else:
            merged.append(dict(item))

    return merged