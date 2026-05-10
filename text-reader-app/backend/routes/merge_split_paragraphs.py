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
    Stitch paragraphs that were split across page breaks.
    Drops interlopers (footers/headers) detected by mismatched font size.
    """
    # print(f"=== merger received {len(structured)} items ===")
    # for s in structured[:10]:
    #     print(f"  [{s['role']}] {s['text'][:80]}")
    if not structured:
        return structured

    def is_interloper(item: dict, body_size: int) -> bool:
        # different font size than body = footer/header leakage
        if abs(item.get("size", body_size) - body_size) >= 1:
            return True
        # also treat headings as interlopers
        if item["role"] == "heading":
            return True
        return False

    merged: list[dict] = []

    for item in structured:
        if item["role"] != "body":
            merged.append(dict(item))
            continue

        body_size = item.get("body_size", item.get("size", 12))

        # walk backward, skipping interlopers (size mismatch or headings)
        i = len(merged) - 1
        skipped_count = 0
        while i >= 0 and is_interloper(merged[i], body_size) and skipped_count < 5:
            i -= 1
            skipped_count += 1

        # found a body paragraph that's mid-sentence + this one continues it
        if (i >= 0
                and merged[i]["role"] == "body"
                and not _ends_with_terminal_punctuation(merged[i]["text"])
                and _starts_lowercase(item["text"])
                and skipped_count > 0):
            merged[i] = {
                **merged[i],
                "text": merged[i]["text"].rstrip() + " " + item["text"].lstrip(),
            }
            del merged[i + 1:]
            continue

        # standard adjacent merge
        if (merged
                and merged[-1]["role"] == "body"
                and not _ends_with_terminal_punctuation(merged[-1]["text"])
                and _starts_lowercase(item["text"])):
            merged[-1] = {
                **merged[-1],
                "text": merged[-1]["text"].rstrip() + " " + item["text"].lstrip(),
            }
        else:
            merged.append(dict(item))

    return merged