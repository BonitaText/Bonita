/**
 * @file utils/sciencePatterns.ts
 *
 * Pattern-based detection of science terms that don't need a dictionary:
 *   - Gene / protein names        BRCA1, TP53, IL-6, mTOR, eIF4E
 *   - Chromosomal loci            7q32.1, 17p13.1, Xq28
 *   - Scientific suffixes         -ology, -itis, -osis, -philic, -ase, etc.
 *   - Species names               Homo sapiens, E. coli, C. elegans
 *   - Drug naming conventions     -mab, -vir, -statin, -olol, -pril
 *   - Chemical formulas           CO2, H2O2, NaCl, C6H12O6
 *
 * All exports are pure functions / compiled RegExps — no DOM access.
 */

// ---------------------------------------------------------------------------
// Gene / protein names
//
// Covers:
//   BRCA1, TP53, EGFR          — all-caps + optional digits
//   IL-6, TNF-α, NF-κB         — caps + hyphen + suffix
//   mTOR, eIF4E, p53            — mixed-case signalling proteins
//   Ras, Myc, Wnt               — oncogene single-word names (3+ caps start)
// ---------------------------------------------------------------------------

export const GENE_PATTERN = /\b(?:[A-Z]{2,5}\d*(?:-[A-Za-zα-ωΑ-Ω0-9]+)*|[a-z]{1,3}[A-Z]{2,4}\d*|[A-Z][a-z]{1,2}\d{1,2})\b/g

// ---------------------------------------------------------------------------
// Chromosomal loci
//
//   7q32.1   17p13.1   Xq28   Yp11   1p36.33
// ---------------------------------------------------------------------------

export const LOCUS_PATTERN = /\b(?:\d{1,2}|[XY])[pq]\d+(?:\.\d+)?\b/g

// ---------------------------------------------------------------------------
// Scientific Latin/Greek suffixes
//
// Matches any word ending in a recognised science suffix.
// The word must be at least 6 chars total to avoid short false positives
// ("ism" matching "prism", etc.)
// ---------------------------------------------------------------------------

const SCIENCE_SUFFIXES = [
  // Biology / medicine
  'ology', 'ologist', 'ological',
  'itis',                          // inflammation: gastritis, arthritis
  'osis', 'oses',                  // condition: fibrosis, cirrhosis
  'asis',                          // condition: psoriasis, leishmaniasis
  'emia', 'aemia',                 // blood: anaemia, leukaemia
  'oma', 'omas', 'omata',          // tumour: carcinoma, lymphoma
  'pathy', 'pathic',               // disease: neuropathy, psychopathic
  'plasty',                        // surgical repair: rhinoplasty
  'ectomy',                        // surgical removal: appendectomy
  'ostomy', 'otomy',               // surgical opening/cutting
  'scopy', 'scope',                // examination: endoscopy, microscope
  'graphy', 'graph',               // recording: radiography, electrocardiograph
  'metry', 'meter',                // measurement: spirometry, barometer
  'genesis', 'genic',              // origin/producing: carcinogenesis, mutagenic
  'lysis', 'lytic',                // breakdown: haemolysis, proteolytic
  'trophy', 'trophic',             // growth/nourishment: hypertrophy, dystrophic
  'phage', 'phagy',                // eating/consuming: bacteriophage, autophagy
  'cytosis', 'cyte',               // cell: phagocytosis, lymphocyte
  'plasm', 'plasmic',              // cellular material: cytoplasm, neoplasm
  'philic', 'philia', 'phile',     // affinity: hydrophilic, eosinophilia
  'phobic', 'phobia',              // aversion: hydrophobic, claustrophobia
  'toxic', 'toxin',                // poison: cytotoxic, neurotoxin
  'ase',                           // enzyme: kinase, lipase, protease
  'zyme',                          // enzyme: enzyme, lysozyme
  'peptide', 'protein',            // biochemistry
  'steroid', 'hormone',
  'receptor', 'ligand',
  'kinase', 'phosphatase',
  // Chemistry
  'oxide', 'hydroxide', 'chloride', 'sulfate', 'phosphate', 'carbonate',
  'amine', 'amide', 'aldehyde', 'ketone', 'alcohol', 'ether',
  'polymer', 'monomer', 'catalyst',
  // General science
  'ism', 'ist',                    // (kept short — filtered by length check)
  'ium',                           // elements: calcium, potassium
  'ion', 'ation', 'ization',       // chemical/process
]

const suffixAlternation = SCIENCE_SUFFIXES
  .sort((a, b) => b.length - a.length) // longest first to avoid partial matches
  .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

export const SUFFIX_PATTERN = new RegExp(
  `\\b[a-zA-Z]{3,}(?:${suffixAlternation})\\b`,
  'gi'
)

// ---------------------------------------------------------------------------
// Species / genus names
//
// Formal binomial:    Homo sapiens, Mus musculus
// Abbreviated:        E. coli, C. elegans, S. cerevisiae
// Single genus:       Streptococcus, Drosophila (capitalised, 8+ chars)
// ---------------------------------------------------------------------------

export const SPECIES_BINOMIAL = /\b[A-Z][a-z]+\s+(?:[a-z]{3,})\b/g
export const SPECIES_ABBREVIATED = /\b[A-Z]\.\s*[a-z]{3,}\b/g
// Single-word genus: capitalised, long enough to be meaningful
export const SPECIES_GENUS = /\b[A-Z][a-z]{7,}\b/g  // e.g. Streptococcus (broad — relies on MeSH to confirm)

// ---------------------------------------------------------------------------
// Drug naming conventions (INN stems)
//
// Monoclonal antibodies:   -mab  (pembrolizumab, rituximab)
// Antivirals:              -vir  (remdesivir, oseltamivir)
// Statins:                 -statin
// Beta blockers:           -olol (metoprolol, atenolol)
// ACE inhibitors:          -pril (lisinopril, ramipril)
// Antibiotics:             -cillin, -mycin, -cycline
// NSAIDs / analgesics:     -profen, -oxicam, -fenac
// Antifungals:             -azole, -afungin
// Biologics misc:          -umab, -zumab, -kinib, -tinib (kinase inhibitors)
// ---------------------------------------------------------------------------

const DRUG_STEMS = [
  'mab', 'umab', 'zumab', 'ximab',        // monoclonal antibodies
  'vir', 'navir', 'fovir',                 // antivirals
  'statin',                                // statins
  'olol',                                  // beta blockers
  'pril', 'april',                         // ACE inhibitors
  'cillin',                                // penicillins
  'mycin', 'micin',                        // aminoglycosides / macrolides
  'cycline',                               // tetracyclines
  'profen',                                // NSAIDs
  'oxicam',                                // NSAIDs
  'fenac',                                 // NSAIDs
  'azole',                                 // antifungals / antiparasitic
  'afungin',                               // antifungals
  'kinib', 'tinib',                        // kinase inhibitors
  'zomib',                                 // proteasome inhibitors
  'rafenib', 'lenib',                      // RAF/tyrosine kinase inhibitors
]

const drugStemAlt = DRUG_STEMS
  .sort((a, b) => b.length - a.length)
  .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

export const DRUG_PATTERN = new RegExp(
  `\\b[a-zA-Z]{4,}(?:${drugStemAlt})\\b`,
  'gi'
)

// ---------------------------------------------------------------------------
// Chemical formulas
//
//   CO2, H2O, NaCl, C6H12O6, Fe2O3
// ---------------------------------------------------------------------------

export const CHEMICAL_FORMULA = /\b(?:[A-Z][a-z]?\d*){2,}\b/g

// ---------------------------------------------------------------------------
// extractSciencePatternTerms
//
// Runs all patterns against raw text (not DOM — caller handles that).
// Returns a deduplicated lowercase array of matched terms.
// ---------------------------------------------------------------------------

export function extractSciencePatternTerms(text: string): string[] {
  const found = new Set<string>()

  function collect(pattern: RegExp, minLen = 2) {
    const clone = new RegExp(pattern.source, pattern.flags)
    let m: RegExpExecArray | null
    while ((m = clone.exec(text)) !== null) {
      const term = m[0].trim()
      if (term.length >= minLen) found.add(term.toLowerCase())
    }
  }

  collect(GENE_PATTERN, 2)
  collect(LOCUS_PATTERN, 3)
  collect(SUFFIX_PATTERN, 6)
  collect(SPECIES_BINOMIAL, 6)
  collect(SPECIES_ABBREVIATED, 4)
  collect(DRUG_PATTERN, 6)
  // Chemical formulas — higher min length to reduce noise
  collect(CHEMICAL_FORMULA, 4)

  return [...found]
}

// ---------------------------------------------------------------------------
// extractItalicScienceTerms
//
// DOM pass — finds text inside <em> or <i> tags that look like species names
// or other science terms typically italicised by convention.
// Returns lowercase deduplicated terms.
// ---------------------------------------------------------------------------

export function extractItalicScienceTerms(): string[] {
  const found = new Set<string>()
  const italicEls = document.querySelectorAll('em, i')

  for (const el of italicEls) {
    const text = (el.textContent ?? '').trim()
    if (text.length < 3) continue

    // Matches binomial species, abbreviated genus, or a long single-word genus
    if (
      SPECIES_BINOMIAL.test(text) ||
      SPECIES_ABBREVIATED.test(text) ||
      /^[A-Z][a-z]{4,}$/.test(text)
    ) {
      found.add(text.toLowerCase())
    }

    // Reset stateful regexes
    SPECIES_BINOMIAL.lastIndex = 0
    SPECIES_ABBREVIATED.lastIndex = 0
  }

  return [...found]
}