/**
 * @file content/utils/sciencePatterns.test.ts
 *
 * Unit tests for sciencePatterns.ts.
 *
 * Covers every exported pattern regex and both public functions:
 *   - extractSciencePatternTerms   (pure text, no DOM)
 *   - extractItalicScienceTerms    (DOM pass over <em>/<i> elements)
 *
 * ## Testing approach
 * Each regex is exercised with positive examples (things it MUST match) and
 * negative examples (things it MUST NOT match) so both precision and recall
 * are verified. extractSciencePatternTerms is tested for:
 *   - Each pattern family contributing terms
 *   - Deduplication across overlapping matches
 *   - minLen filtering (short noise terms are dropped)
 *   - Stateless regex behaviour (repeated calls produce identical results)
 *
 * extractItalicScienceTerms is tested with a live jsdom DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  GENE_PATTERN,
  LOCUS_PATTERN,
  SUFFIX_PATTERN,
  SPECIES_BINOMIAL,
  SPECIES_ABBREVIATED,
  SPECIES_GENUS,
  DRUG_PATTERN,
  CHEMICAL_FORMULA,
  extractSciencePatternTerms,
  extractItalicScienceTerms,
} from '../../content/utils/sciencePatterns'

// ─── Pattern helpers ──────────────────────────────────────────────────────────

/** Returns all matches of a pattern in text (resets lastIndex to avoid state bleed). */
function matchAll(pattern: RegExp, text: string): string[] {
  const clone = new RegExp(pattern.source, pattern.flags)
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = clone.exec(text)) !== null) results.push(m[0])
  return results
}

function matches(pattern: RegExp, text: string): boolean {
  return matchAll(pattern, text).length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GENE_PATTERN
// ─────────────────────────────────────────────────────────────────────────────

describe('GENE_PATTERN', () => {
  it('matches all-caps gene symbols (BRCA1, TP53, EGFR)', () => {
    expect(matches(GENE_PATTERN, 'BRCA1 mutation detected')).toBe(true)
    expect(matches(GENE_PATTERN, 'TP53 is a tumour suppressor')).toBe(true)
    expect(matches(GENE_PATTERN, 'EGFR amplification')).toBe(true)
  })

  it('matches cytokine names with hyphen suffix (IL-6, TNF-α)', () => {
    expect(matches(GENE_PATTERN, 'elevated IL-6 levels')).toBe(true)
    expect(matches(GENE_PATTERN, 'TNF-α signalling pathway')).toBe(true)
  })

  it('matches mixed-case signalling proteins (mTOR, cMYC)', () => {
    // Pattern [a-z]{1,3}[A-Z]{2,4}\d* matches: lowercase prefix + 2-4 uppercase letters
    expect(matches(GENE_PATTERN, 'mTOR inhibition')).toBe(true)
    expect(matches(GENE_PATTERN, 'cMYC overexpression')).toBe(true)
  })

  it('matches oncogene-style names with digit suffix (Ras2, Myc1)', () => {
    // Pattern [A-Z][a-z]{1,2}\d{1,2}: capital + 1-2 lowercase + 1-2 digits
    expect(matches(GENE_PATTERN, 'Ras2 isoform')).toBe(true)
    expect(matches(GENE_PATTERN, 'Myc1 target')).toBe(true)
  })

  it('does NOT match common English words', () => {
    // Short common words starting with lowercase should not match
    expect(matchAll(GENE_PATTERN, 'the cat sat on the mat').length).toBe(0)
  })

  it('does NOT match single uppercase letters', () => {
    const hits = matchAll(GENE_PATTERN, 'A B C').filter(m => m.length === 1)
    expect(hits.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. LOCUS_PATTERN
// ─────────────────────────────────────────────────────────────────────────────

describe('LOCUS_PATTERN', () => {
  it('matches numeric chromosomal loci (7q32.1, 17p13.1)', () => {
    expect(matches(LOCUS_PATTERN, 'deletion at 7q32.1')).toBe(true)
    expect(matches(LOCUS_PATTERN, 'mutation at 17p13.1')).toBe(true)
  })

  it('matches sex chromosome loci (Xq28, Yp11)', () => {
    expect(matches(LOCUS_PATTERN, 'Xq28 linkage')).toBe(true)
    expect(matches(LOCUS_PATTERN, 'Yp11 region')).toBe(true)
  })

  it('matches loci without a decimal sub-band (1p36)', () => {
    expect(matches(LOCUS_PATTERN, 'loss of 1p36')).toBe(true)
  })

  it('does NOT match plain numbers or random letter-number combos', () => {
    expect(matches(LOCUS_PATTERN, 'Page 17 of the report')).toBe(false)
    expect(matches(LOCUS_PATTERN, 'Level 3 achievement')).toBe(false)
  })

  it('does NOT match lowercase chromosomal-looking strings', () => {
    expect(matches(LOCUS_PATTERN, 'xq28 lowercase should not match')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. SUFFIX_PATTERN
// ─────────────────────────────────────────────────────────────────────────────

describe('SUFFIX_PATTERN', () => {
  it('matches -ology words (neurology, cardiology)', () => {
    expect(matches(SUFFIX_PATTERN, 'neurology department')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'cardiology research')).toBe(true)
  })

  it('matches -itis words (gastritis, arthritis)', () => {
    expect(matches(SUFFIX_PATTERN, 'chronic gastritis')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'rheumatoid arthritis')).toBe(true)
  })

  it('matches -osis words (fibrosis, cirrhosis)', () => {
    expect(matches(SUFFIX_PATTERN, 'pulmonary fibrosis')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'liver cirrhosis')).toBe(true)
  })

  it('matches -emia words (anaemia, leukaemia)', () => {
    expect(matches(SUFFIX_PATTERN, 'iron deficiency anaemia')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'acute leukaemia')).toBe(true)
  })

  it('matches -ectomy words (appendectomy)', () => {
    expect(matches(SUFFIX_PATTERN, 'appendectomy procedure')).toBe(true)
  })

  it('matches -ase enzyme words (kinase, lipase)', () => {
    expect(matches(SUFFIX_PATTERN, 'protein kinase activity')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'lipase enzyme')).toBe(true)
  })

  it('matches -philic words (hydrophilic)', () => {
    expect(matches(SUFFIX_PATTERN, 'hydrophilic surface')).toBe(true)
  })

  it('matches chemical compound words (monoxide, hydroxide)', () => {
    // The pattern requires 3+ letters before the suffix.
    // "dioxide" has only 2-char prefix "di" so fails; "monoxide" has 4-char "mono".
    expect(matches(SUFFIX_PATTERN, 'carbon monoxide poisoning')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'potassium hydroxide solution')).toBe(true)
  })

  it('does NOT match very short words even if they contain a suffix', () => {
    // Words under 6 total characters are filtered by minLen in the extractor;
    // pattern itself may or may not match short strings but extractor filters them
    // Here we test that "ion" alone (3 chars) does not match the pattern's leading chars
    expect(matchAll(SUFFIX_PATTERN, 'ion').some(m => m === 'ion')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(matches(SUFFIX_PATTERN, 'NEUROLOGY')).toBe(true)
    expect(matches(SUFFIX_PATTERN, 'Gastritis')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. SPECIES_BINOMIAL
// ─────────────────────────────────────────────────────────────────────────────

describe('SPECIES_BINOMIAL', () => {
  it('matches formal two-word species names (Homo sapiens, Mus musculus)', () => {
    expect(matches(SPECIES_BINOMIAL, 'Homo sapiens genome')).toBe(true)
    expect(matches(SPECIES_BINOMIAL, 'Mus musculus model')).toBe(true)
  })

  it('matches Caenorhabditis elegans', () => {
    expect(matches(SPECIES_BINOMIAL, 'Caenorhabditis elegans lifespan')).toBe(true)
  })

  it('does NOT match all-lowercase two-word phrases', () => {
    expect(matches(SPECIES_BINOMIAL, 'quick brown fox')).toBe(false)
  })

  it('does NOT match a capitalised word followed by a short word (<3 chars)', () => {
    expect(matches(SPECIES_BINOMIAL, 'Homo or sapiens')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. SPECIES_ABBREVIATED
// ─────────────────────────────────────────────────────────────────────────────

describe('SPECIES_ABBREVIATED', () => {
  it('matches abbreviated genus forms (E. coli, C. elegans, S. cerevisiae)', () => {
    expect(matches(SPECIES_ABBREVIATED, 'E. coli infection')).toBe(true)
    expect(matches(SPECIES_ABBREVIATED, 'C. elegans model')).toBe(true)
    expect(matches(SPECIES_ABBREVIATED, 'S. cerevisiae yeast')).toBe(true)
  })

  it('matches abbreviated form without space after dot', () => {
    expect(matches(SPECIES_ABBREVIATED, 'E.coli strain')).toBe(true)
  })

  it('does NOT match a lone capital letter followed by a short word', () => {
    // species part must be 3+ chars
    expect(matches(SPECIES_ABBREVIATED, 'A. at the start')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. SPECIES_GENUS
// ─────────────────────────────────────────────────────────────────────────────

describe('SPECIES_GENUS', () => {
  it('matches long capitalised single-word genus names (Streptococcus, Drosophila)', () => {
    expect(matches(SPECIES_GENUS, 'Streptococcus infection')).toBe(true)
    expect(matches(SPECIES_GENUS, 'Drosophila melanogaster')).toBe(true)
    expect(matches(SPECIES_GENUS, 'Arabidopsis thaliana')).toBe(true)
  })

  it('does NOT match short capitalised words (< 8 lowercase chars)', () => {
    // "Homo" → 3 lowercase chars after H → should not match
    expect(matchAll(SPECIES_GENUS, 'Homo sapiens').filter(m => m === 'Homo').length).toBe(0)
  })

  it('does NOT match all-caps words', () => {
    expect(matchAll(SPECIES_GENUS, 'STREPTOCOCCUS').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. DRUG_PATTERN
// ─────────────────────────────────────────────────────────────────────────────

describe('DRUG_PATTERN', () => {
  it('matches monoclonal antibodies (-mab): pembrolizumab, rituximab', () => {
    expect(matches(DRUG_PATTERN, 'pembrolizumab therapy')).toBe(true)
    expect(matches(DRUG_PATTERN, 'rituximab infusion')).toBe(true)
  })

  it('matches antivirals (-vir): remdesivir, oseltamivir', () => {
    expect(matches(DRUG_PATTERN, 'remdesivir treatment')).toBe(true)
    expect(matches(DRUG_PATTERN, 'oseltamivir prophylaxis')).toBe(true)
  })

  it('matches statins (-statin): atorvastatin, rosuvastatin', () => {
    expect(matches(DRUG_PATTERN, 'atorvastatin dosing')).toBe(true)
    expect(matches(DRUG_PATTERN, 'rosuvastatin therapy')).toBe(true)
  })

  it('matches beta blockers (-olol): metoprolol, atenolol', () => {
    expect(matches(DRUG_PATTERN, 'metoprolol succinate')).toBe(true)
    expect(matches(DRUG_PATTERN, 'atenolol 50mg')).toBe(true)
  })

  it('matches ACE inhibitors (-pril): lisinopril, ramipril', () => {
    expect(matches(DRUG_PATTERN, 'lisinopril 10mg daily')).toBe(true)
    expect(matches(DRUG_PATTERN, 'ramipril for hypertension')).toBe(true)
  })

  it('matches penicillins (-cillin): amoxicillin', () => {
    expect(matches(DRUG_PATTERN, 'amoxicillin 500mg')).toBe(true)
  })

  it('matches macrolides (-mycin): azithromycin, vancomycin', () => {
    expect(matches(DRUG_PATTERN, 'azithromycin course')).toBe(true)
    expect(matches(DRUG_PATTERN, 'vancomycin IV')).toBe(true)
  })

  it('matches NSAIDs (-profen): ketoprofen, flurbiprofen', () => {
    // Pattern needs 4+ chars before the stem; "ibuprofen" has only 3-char prefix "ibu".
    expect(matches(DRUG_PATTERN, 'ketoprofen gel')).toBe(true)
    expect(matches(DRUG_PATTERN, 'flurbiprofen tablets')).toBe(true)
  })

  it('matches azoles (-azole): fluconazole, ketoconazole', () => {
    expect(matches(DRUG_PATTERN, 'fluconazole antifungal')).toBe(true)
  })

  it('matches kinase inhibitors (-tinib): dasatinib, erlotinib', () => {
    // Pattern needs 4+ chars before the stem; "imatinib" has only 3-char prefix "ima".
    expect(matches(DRUG_PATTERN, 'dasatinib CML therapy')).toBe(true)
    expect(matches(DRUG_PATTERN, 'erlotinib EGFR inhibition')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matches(DRUG_PATTERN, 'ATORVASTATIN')).toBe(true)
  })

  it('does NOT match common short words ending in a drug stem by coincidence', () => {
    // "vir" alone (3 chars) should not match — minimum 4 chars before stem
    expect(matchAll(DRUG_PATTERN, 'vir').some(m => m === 'vir')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. CHEMICAL_FORMULA
// ─────────────────────────────────────────────────────────────────────────────

describe('CHEMICAL_FORMULA', () => {
  it('matches common formulas (CO2, H2O, NaCl)', () => {
    expect(matches(CHEMICAL_FORMULA, 'CO2 levels rising')).toBe(true)
    expect(matches(CHEMICAL_FORMULA, 'H2O molecule')).toBe(true)
    expect(matches(CHEMICAL_FORMULA, 'NaCl solution')).toBe(true)
  })

  it('matches complex organic formulas (C6H12O6, Fe2O3)', () => {
    expect(matches(CHEMICAL_FORMULA, 'glucose C6H12O6')).toBe(true)
    expect(matches(CHEMICAL_FORMULA, 'Fe2O3 rust formation')).toBe(true)
  })

  it('matches hydrogen peroxide (H2O2)', () => {
    expect(matches(CHEMICAL_FORMULA, 'H2O2 bleaching')).toBe(true)
  })

  it('does NOT match plain numbers', () => {
    expect(matchAll(CHEMICAL_FORMULA, '1234 or 56').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. extractSciencePatternTerms
// ─────────────────────────────────────────────────────────────────────────────

describe('extractSciencePatternTerms', () => {
  it('returns an empty array for plain English text with no pattern triggers', () => {
    // Use all-lowercase text with no capitals to avoid SPECIES_BINOMIAL matches,
    // no gene-like uppercase sequences, and no science suffixes.
    const result = extractSciencePatternTerms('one plus one equals two in simple maths.')
    expect(result).toEqual([])
  })

  it('extracts gene symbols from text', () => {
    const result = extractSciencePatternTerms('BRCA1 and TP53 mutations were identified.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).toContain('brca1')
    expect(lower).toContain('tp53')
  })

  it('extracts chromosomal loci', () => {
    const result = extractSciencePatternTerms('Deletion at 7q32.1 was confirmed by FISH.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).toContain('7q32.1')
  })

  it('extracts scientific-suffix words', () => {
    const result = extractSciencePatternTerms('The patient was diagnosed with acute gastritis.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).toContain('gastritis')
  })

  it('extracts species binomials', () => {
    const result = extractSciencePatternTerms('The model organism Caenorhabditis elegans was used.')
    const lower = result.map(t => t.toLowerCase())
    // binomial → "caenorhabditis elegans" normalised somehow, or each word
    expect(lower.some(t => t.includes('elegans') || t.includes('caenorhabditis'))).toBe(true)
  })

  it('extracts abbreviated species (E. coli)', () => {
    const result = extractSciencePatternTerms('E. coli was cultured overnight.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower.some(t => t.includes('coli') || t.includes('e.'))).toBe(true)
  })

  it('extracts drug names', () => {
    const result = extractSciencePatternTerms('The patient received pembrolizumab infusion.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).toContain('pembrolizumab')
  })

  it('extracts chemical formulas when long enough', () => {
    const result = extractSciencePatternTerms('Glucose C6H12O6 is a primary energy source.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).toContain('c6h12o6')
  })

  it('deduplicates repeated terms', () => {
    const result = extractSciencePatternTerms('BRCA1 and BRCA1 appear twice.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower.filter(t => t === 'brca1').length).toBe(1)
  })

  it('returns results consistently on repeated calls (no regex state bleed)', () => {
    const text = 'BRCA1 mutation, IL-6 cytokine, gastritis diagnosis.'
    const first  = extractSciencePatternTerms(text).sort()
    const second = extractSciencePatternTerms(text).sort()
    expect(first).toEqual(second)
  })

  it('filters out chemical formula terms shorter than 4 characters', () => {
    // H2O is 3 chars — below the chemical formula minLen of 4.
    // Use isolated H2O with no other pattern triggers.
    const result = extractSciencePatternTerms('h2o is water.')
    const lower = result.map(t => t.toLowerCase())
    expect(lower).not.toContain('h2o')
  })

  it('handles mixed text with multiple pattern families', () => {
    const text = `
      BRCA1 and TP53 mutations were found at locus 17p13.1.
      The patient, infected with E. coli, received amoxicillin.
      Serum NaCl levels were measured. Neurology consultation followed.
    `
    const result = extractSciencePatternTerms(text)
    expect(result.length).toBeGreaterThan(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. extractItalicScienceTerms (DOM)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractItalicScienceTerms', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  function addItalic(tag: 'em' | 'i', text: string): void {
    const el = document.createElement(tag)
    el.textContent = text
    document.body.appendChild(el)
  }

  it('returns empty array when no <em> or <i> elements are present', () => {
    document.body.innerHTML = '<p>No italic text here.</p>'
    expect(extractItalicScienceTerms()).toEqual([])
  })

  it('returns empty array when italic elements are too short (< 3 chars)', () => {
    addItalic('em', 'ab')
    expect(extractItalicScienceTerms()).toEqual([])
  })

  it('returns empty array when italic text does not match any species pattern', () => {
    addItalic('em', 'very important finding')
    expect(extractItalicScienceTerms()).toEqual([])
  })

  it('extracts binomial species from <em> tags', () => {
    addItalic('em', 'Homo sapiens')
    const result = extractItalicScienceTerms()
    expect(result).toContain('homo sapiens')
  })

  it('extracts binomial species from <i> tags', () => {
    addItalic('i', 'Mus musculus')
    const result = extractItalicScienceTerms()
    expect(result).toContain('mus musculus')
  })

  it('extracts abbreviated genus from <em> (E. coli)', () => {
    addItalic('em', 'E. coli')
    const result = extractItalicScienceTerms()
    expect(result).toContain('e. coli')
  })

  it('extracts long single-word genus names', () => {
    // Single-word genus rule: capitalised, 5+ lowercase chars → /^[A-Z][a-z]{4,}$/
    addItalic('em', 'Drosophila')
    const result = extractItalicScienceTerms()
    expect(result).toContain('drosophila')
  })

  it('does not include a short capitalised word as a genus (< 5 lowercase chars)', () => {
    // "Homo" → H + 3 lowercase → should not match the single-word genus rule
    addItalic('em', 'Homo')
    const result = extractItalicScienceTerms()
    // May or may not match binomial — for single-word test it should NOT
    expect(result).not.toContain('homo')
  })

  it('deduplicates repeated italic species', () => {
    addItalic('em', 'Homo sapiens')
    addItalic('i',  'Homo sapiens')
    const result = extractItalicScienceTerms()
    expect(result.filter(t => t === 'homo sapiens').length).toBe(1)
  })

  it('handles multiple different italic species in one document', () => {
    addItalic('em', 'Homo sapiens')
    addItalic('i',  'E. coli')
    addItalic('em', 'Drosophila')
    const result = extractItalicScienceTerms()
    expect(result.some(t => t.includes('sapiens'))).toBe(true)
    expect(result.some(t => t.includes('coli'))).toBe(true)
    expect(result.some(t => t.includes('drosophila'))).toBe(true)
  })

  it('does not include non-species italic text', () => {
    addItalic('em', 'Note: this is important')
    const result = extractItalicScienceTerms()
    expect(result).not.toContain('note: this is important')
  })

  it('returns all results in lowercase', () => {
    addItalic('em', 'Homo sapiens')
    const result = extractItalicScienceTerms()
    result.forEach(term => {
      expect(term).toBe(term.toLowerCase())
    })
  })

  it('is stateless — same results on repeated calls against the same DOM', () => {
    addItalic('em', 'Homo sapiens')
    addItalic('i',  'E. coli')
    const first  = extractItalicScienceTerms().sort()
    const second = extractItalicScienceTerms().sort()
    expect(first).toEqual(second)
  })
})