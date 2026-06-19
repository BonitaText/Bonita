/**
 * scripts/buildMeshTerms.ts
 *
 * Run once at build time (or whenever you want to update MeSH):
 *
 *   npx ts-node src/scripts/buildMeshTerms.ts
 *
 * Outputs: src/assets/meshTerms.json
 *
 * MeSH branches included:
 *   A - Anatomy
 *   B - Organisms
 *   C - Diseases
 *   D - Chemicals & Drugs
 *   E - Analytical/Diagnostic/Therapeutic Techniques
 *   F - Psychiatry & Psychology
 *   G - Biological Sciences
 *   H - Disciplines & Occupations
 *   I - Anthropology, Education, Sociology
 *   J - Technology & Industry (partially — food, environment)
 *   N - Health Care
 *
 * Excluded (noise for science bolding):
 *   K - Humanities
 *   L - Information Science
 *   M - Named Groups (demographic labels)
 *   V - Publication Types
 *   Z - Geographic Locations
 */

import { XMLParser } from 'fast-xml-parser'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Plain XML — no gzip needed. Update year annually.
const MESH_URL =
  'https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.zip'
// MeSH top-level tree branches to keep
const ALLOWED_BRANCHES = new Set([
  'A', // Anatomy
  'B', // Organisms
  'C', // Diseases
  'D', // Chemicals & Drugs
  'E', // Techniques & Equipment
  'F', // Psychiatry & Psychology
  'G', // Biological Sciences
  'H', // Disciplines & Occupations
  'I', // Anthropology, Education, Sociology
  'J', // Technology, Industry, Agriculture
  'N', // Health Care
])

// Branch → importance weight (used by phraseExtractor scoring)
export const BRANCH_WEIGHTS: Record<string, number> = {
  A: 1.2, // Anatomy — specific, useful
  B: 1.3, // Organisms — species names, very specific
  C: 1.5, // Diseases — highest priority
  D: 1.4, // Chemicals & Drugs — very specific
  E: 1.1, // Techniques — useful but broader
  F: 1.1, // Psychiatry — useful
  G: 1.3, // Biological Sciences — core science
  H: 0.9, // Disciplines — less specific ("biology", "medicine")
  I: 0.8, // Anthropology/Education — lower priority
  J: 0.9, // Technology/Industry — mixed bag
  N: 1.0, // Health Care — useful but noisy
}

// ---------------------------------------------------------------------------
// Download helper — follows redirects, works with both http and https
// ---------------------------------------------------------------------------

function download(url: string, redirectLimit = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirectLimit === 0) {
      reject(new Error('Too many redirects'))
      return
    }

    const client = url.startsWith('https') ? https : http

    client.get(url, (res) => {
      // Follow redirects (301, 302, 307, 308)
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        console.log(`  Redirecting to ${res.headers.location}`)
        resolve(download(res.headers.location, redirectLimit - 1))
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }

      const chunks: Buffer[] = []
      let downloaded = 0
      const total = parseInt(res.headers['content-length'] ?? '0', 10)

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        downloaded += chunk.length
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(0)
          process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`)
        } else {
          process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)} MB downloaded`)
        }
      })
      res.on('end', () => {
        process.stdout.write('\n')
        resolve(Buffer.concat(chunks))
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Parse MeSH XML → flat term list with branch weights
// ---------------------------------------------------------------------------

interface MeshEntry {
  term: string
  branch: string
  weight: number
}

function parseMesh(xml: string): MeshEntry[] {
  const parser = new XMLParser({ ignoreAttributes: false })
  const parsed = parser.parse(xml)

  const descriptors = parsed?.DescriptorRecordSet?.DescriptorRecord ?? []
  const entries: MeshEntry[] = []
  const seen = new Set<string>()

  for (const descriptor of descriptors) {
    // Get tree numbers — a term can belong to multiple branches
    const treeNumbers: string[] = []
    const treeList = descriptor?.TreeNumberList?.TreeNumber
    if (!treeList) continue

    const trees = Array.isArray(treeList) ? treeList : [treeList]
    for (const tree of trees) {
      const branch = String(tree)[0]?.toUpperCase()
      if (branch && ALLOWED_BRANCHES.has(branch)) {
        treeNumbers.push(branch)
      }
    }
    if (treeNumbers.length === 0) continue

    // Pick the highest-weighted branch this term belongs to
    const topBranch = treeNumbers.reduce((best, b) =>
      (BRANCH_WEIGHTS[b] ?? 0) > (BRANCH_WEIGHTS[best] ?? 0) ? b : best
    )

    // Collect the preferred term + all entry term names
    const allTerms: string[] = []

    const preferredName = descriptor?.DescriptorName?.String
    if (preferredName) allTerms.push(String(preferredName))

    // Entry terms (synonyms / alternate forms)
    const conceptList = descriptor?.ConceptList?.Concept
    const concepts = conceptList
      ? Array.isArray(conceptList) ? conceptList : [conceptList]
      : []

    for (const concept of concepts) {
      const termList = concept?.TermList?.Term
      const terms = termList
        ? Array.isArray(termList) ? termList : [termList]
        : []
      for (const t of terms) {
        const name = t?.String
        if (name) allTerms.push(String(name))
      }
    }

    // Emit each unique term (lowercase for matching)
    for (const rawTerm of allTerms) {
      const term = rawTerm.trim().toLowerCase()
      // Skip single-character terms or pure numbers
      if (term.length < 2 || /^\d+$/.test(term)) continue
      if (seen.has(term)) continue
      seen.add(term)
      entries.push({ term, branch: topBranch, weight: BRANCH_WEIGHTS[topBranch] ?? 1.0 })
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Downloading MeSH ZIP from:\n  ${MESH_URL}`)
  console.log('This is ~10 MB zipped — should be quick...\n')

  const buffer = await download(MESH_URL)
  console.log(`\nDownloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`)
  console.log('Unzipping...')

  // Node has no built-in zip — use the 'adm-zip' package
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(buffer)
  const entry = zip.getEntries().find(e => e.entryName.endsWith('.xml'))
  if (!entry) throw new Error('No XML file found in ZIP')
  const xml = zip.readAsText(entry)

  console.log(`Unzipped ${(xml.length / 1024 / 1024).toFixed(1)} MB of XML`)
  console.log('Parsing...')

  const entries = parseMesh(xml)
  console.log(`Parsed ${entries.length} terms`)

  
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const outPath = path.resolve(__dirname, '../assets/meshTerms.json')

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(entries), 'utf-8')
  console.log(`\nWritten to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})