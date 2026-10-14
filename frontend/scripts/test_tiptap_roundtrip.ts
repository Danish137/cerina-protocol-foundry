import fs from 'fs'
import path from 'path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

async function runRoundtrip() {
  const fixturesDir = path.resolve(process.cwd(), '../backend/tests/fixtures/drafts')
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.md')).sort((a, b) => {
    const numA = parseInt(a.replace(/[^0-9]/g, ''), 10)
    const numB = parseInt(b.replace(/[^0-9]/g, ''), 10)
    return numA - numB
  })

  console.log(`Found ${files.length} fixture drafts in ${fixturesDir}`)

  const editor = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true
      })
    ]
  })

  const results: string[] = []
  results.push('=== TIPTAP MARKDOWN ROUNDTRIP ON 11 FIXTURES ===\n')

  let passCount = 0

  for (const file of files) {
    const filePath = path.join(fixturesDir, file)
    const original = fs.readFileSync(filePath, 'utf-8')

    // 1. Load into TipTap
    editor.commands.setContent(original)

    // 2. Extract markdown
    // @ts-ignore
    const roundtripped = editor.storage.markdown.getMarkdown() as string

    // Check headings preservation
    const origHeadings = (original.match(/^#+\s+.+$/gm) || []).map(h => h.trim())
    const roundHeadings = (roundtripped.match(/^#+\s+.+$/gm) || []).map(h => h.trim())

    const headingsPreserved = origHeadings.length === roundHeadings.length
    const lengthDelta = Math.abs(original.length - roundtripped.length)
    const ratio = (roundtripped.length / original.length).toFixed(3)

    const passed = headingsPreserved && Math.abs(1.0 - parseFloat(ratio)) < 0.15
    if (passed) passCount++

    results.push(`--- ${file} ---`)
    results.push(`Original chars: ${original.length} | Roundtripped chars: ${roundtripped.length} (Ratio: ${ratio})`)
    results.push(`Headings (Orig vs RT): ${origHeadings.length} vs ${roundHeadings.length} -> Preserved: ${headingsPreserved}`)
    results.push(`Status: ${passed ? 'PASS' : 'INSPECT'}\n`)
  }

  results.push(`SUMMARY: ${passCount} / ${files.length} fixtures passed roundtrip fidelity.\n`)
  const outPath = path.resolve(process.cwd(), '../docs/evidence/tiptap_roundtrip.txt')
  fs.writeFileSync(outPath, results.join('\n'), 'utf-8')
  console.log(`Saved results to ${outPath}`)
  console.log(results.join('\n'))
}

runRoundtrip().catch(e => {
  console.error('TipTap test error:', e)
  process.exit(1)
})
