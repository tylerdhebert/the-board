/**
 * Backfill `difficulty` onto cards/*.card.json that are missing it.
 * Resolves LC slug from the card filename (with a few underscore-name maps),
 * fetches from LeetCode, patches the JSON in place.
 *
 *   node scripts/backfill-difficulty.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cardsDir = path.join(repoRoot, 'cards')

/** Underscore card names that don't map 1:1 via underscore→hyphen. */
const SLUG_MAP = {
  two_sum: 'two-sum',
  house_robber: 'house-robber',
  container_water: 'container-with-most-water',
}

function slugFromCardName(name) {
  if (SLUG_MAP[name]) return SLUG_MAP[name]
  return name.replace(/_/g, '-')
}

async function fetchDifficulty(slug) {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://leetcode.com/problems/${slug}/`,
    },
    body: JSON.stringify({
      query:
        'query q($titleSlug: String!){ question(titleSlug:$titleSlug){ difficulty } }',
      variables: { titleSlug: slug },
    }),
  })
  if (!res.ok) {
    throw new Error(`LeetCode GraphQL request failed with status ${res.status}`)
  }
  const json = await res.json()
  const difficulty = json?.data?.question?.difficulty
  if (!difficulty) {
    throw new Error(`problem not found or premium-locked: ${slug}`)
  }
  return difficulty
}

async function main() {
  const entries = await readdir(cardsDir)
  const cards = entries.filter((e) => e.endsWith('.card.json')).sort()
  for (const entry of cards) {
    const name = entry.slice(0, -'.card.json'.length)
    const filePath = path.join(cardsDir, entry)
    const raw = await readFile(filePath, 'utf8')
    const card = JSON.parse(raw)
    if (card.difficulty) {
      console.log(`${name}: already has difficulty=${card.difficulty}`)
      continue
    }
    const slug = slugFromCardName(name)
    try {
      const difficulty = await fetchDifficulty(slug)
      // Preserve original formatting: minified stays minified; pretty stays pretty.
      const minified = !raw.includes('\n')
      let next
      if (minified) {
        next = raw.replace(/\}\s*$/, `,"difficulty":${JSON.stringify(difficulty)}}`)
      } else {
        card.difficulty = difficulty
        const endsWithNewline = raw.endsWith('\n')
        next = JSON.stringify(card, null, 2) + (endsWithNewline ? '\n' : '')
      }
      await writeFile(filePath, next, 'utf8')
      console.log(`${name}: set difficulty=${difficulty} (slug=${slug})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`${name}: FAILED slug=${slug} — ${message}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
