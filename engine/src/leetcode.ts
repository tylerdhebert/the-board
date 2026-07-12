import type { Example, Judge } from './types.js';

export interface CodeSnippet {
  lang: string; // display name, e.g. "C#"
  langSlug: string; // e.g. "csharp", "typescript", "python3"
  code: string; // the starter stub LeetCode shows in its editor
}

export interface LeetCodeProblem {
  title: string;
  slug: string;
  difficulty: string;
  url: string; // canonical problem page, for the submit link
  contentHtml: string; // raw HTML from LeetCode
  statement: string; // full markdown with title header, ready to feed to ingest()
  statementMd: string; // verbatim statement as markdown (no header, no constraints)
  constraintsMd: string; // verbatim constraints + follow-up; '' if no marker found
  codeSnippets: CodeSnippet[]; // per-language starter scaffolds
  /** Raw JSON string from LeetCode GraphQL; used to detect judge. */
  metaData?: string;
}

export function slugFromUrl(input: string): string {
  const trimmed = input.trim();
  const problemsIdx = trimmed.indexOf('/problems/');
  if (problemsIdx !== -1) {
    const after = trimmed.slice(problemsIdx + '/problems/'.length);
    const slug = after.split(/[/?#]/)[0];
    if (slug) return slug.toLowerCase();
    throw new Error(`could not derive LeetCode slug from: ${input}`);
  }
  if (!trimmed.includes('/')) {
    const slug = trimmed.toLowerCase();
    if (slug) return slug;
  }
  throw new Error(`could not derive LeetCode slug from: ${input}`);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Convert LeetCode statement HTML to the markdown subset the UI renders:
 * `inline code`, **bold**, *italic*, fenced blocks (examples), plain "- "
 * list lines. Images become ![alt](url) on their own line — the caller
 * decides whether to download them (figures) or strip them (prompts).
 */
export function htmlToMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Protect <pre> example blocks as fences before inline processing.
  const fences: string[] = [];
  text = text.replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    let body = inner.replace(/<br\s*\/?>/gi, '\n');
    body = body.replace(/<sup(?:\s[^>]*)?>([\s\S]*?)<\/sup>/gi, '^$1');
    body = body.replace(/<[^>]+>/g, '');
    body = decodeEntities(body).replace(/^\n+/, '').replace(/\s+$/, '');
    fences.push('```\n' + body + '\n```');
    return `\n@@FENCE${fences.length - 1}@@\n`;
  });
  text = text.replace(/<img[^>]*>/gi, (tag) => {
    const src = /src\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ?? '';
    if (!src) return '';
    const alt = /alt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    return `\n![${alt}](${src})\n`;
  });
  text = text.replace(/<sup(?:\s[^>]*)?>([\s\S]*?)<\/sup>/gi, '^$1');
  text = text.replace(/<sub(?:\s[^>]*)?>([\s\S]*?)<\/sub>/gi, '$1');
  text = text.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '*$2*');
  text = text.replace(
    /<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi,
    (_, inner: string) => '`' + inner.replace(/<[^>]+>/g, '') + '`',
  );
  text = text.replace(/<li(?:\s[^>]*)?>/gi, '- ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|ul|ol)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  // LC's <ul> markup indents <li> lines; dedent before fences come back.
  text = text.replace(/^[ \t]+(?=- )/gm, '');
  // The UI renders this under pre-wrap, where every blank line is literal:
  // fences hug their label line and list items single-space, or the
  // statement doubles in height.
  text = text.replace(/\n{2,}(@@FENCE\d+@@)/g, '\n$1');
  text = text.replace(/(@@FENCE\d+@@)\n{2,}/g, '$1\n');
  text = text.replace(/\n{2,}(!\[[^\]\n]*\]\([^)\n]+\))/g, '\n$1');
  text = text.replace(/(!\[[^\]\n]*\]\([^)\n]+\))\n{2,}/g, '$1\n');
  text = text.replace(/^(- [^\n]*)\n{2,}(?=- )/gm, '$1\n');
  text = text.replace(/@@FENCE(\d+)@@/g, (_, i: string) => fences[Number(i)] ?? '');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** Split converted markdown at LC's "**Constraints:**" marker line. */
export function splitStatement(md: string): { statementMd: string; constraintsMd: string } {
  const m = /^\*\*Constraints:\*\*\s*$/m.exec(md);
  if (!m) return { statementMd: md, constraintsMd: '' };
  return {
    statementMd: md.slice(0, m.index).trim(),
    constraintsMd: md.slice(m.index + m[0].length).trim(),
  };
}

/** For prompt text: replace markdown images with a short [figure: alt] token. */
export function stripFigureRefs(md: string): string {
  return md
    .replace(/!\[([^\]\n]*)\]\([^)\n]+\)/g, (_, alt: string) =>
      alt.trim() ? `[figure: ${alt.trim()}]` : '[figure]')
    .replace(/\n{3,}/g, '\n\n');
}

const FIGURE_FETCH_TIMEOUT_MS = 8_000;
const FIGURE_MAX_BYTES = 3_000_000;
const FIGURE_MAX_COUNT = 8;

/**
 * Download ![alt](https://...) images and rewrite them to ![alt](figure:N)
 * placeholders backed by data-URI figures — statements stay offline-correct.
 * Images that fail to download are dropped from the markdown.
 */
export async function inlineFigures(
  md: string,
): Promise<{ md: string; figures: { alt: string; data: string }[] }> {
  const figures: { alt: string; data: string }[] = [];
  const matches = [...md.matchAll(/!\[([^\]\n]*)\]\((https?:[^)\s]+)\)/g)];
  let out = md;
  for (const m of matches) {
    const [ref, alt = '', src = ''] = m;
    let replacement = '';
    if (figures.length < FIGURE_MAX_COUNT) {
      try {
        const res = await fetch(src, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://leetcode.com/' },
          signal: AbortSignal.timeout(FIGURE_FETCH_TIMEOUT_MS),
        });
        const mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (res.ok && mime.startsWith('image/')) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength <= FIGURE_MAX_BYTES) {
            figures.push({ alt, data: `data:${mime};base64,${buf.toString('base64')}` });
            replacement = `![${alt}](figure:${figures.length - 1})`;
          }
        }
      } catch {
        // unreachable/slow image: drop it, the LC link covers the gap
      }
    }
    out = out.replace(ref, replacement);
  }
  return { md: out.replace(/\n{3,}/g, '\n\n'), figures };
}

type MetaParam = { name?: string; type?: string };
type MetaData = {
  name?: string;
  params?: MetaParam[];
  return?: { type?: string };
};

function parseMetaData(raw: string | null | undefined): MetaData | null {
  if (raw == null || typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as MetaData;
  } catch {
    return null;
  }
}

function firstArrayArgIndex(params: MetaParam[] | undefined): number {
  if (!params?.length) return 0;
  const idx = params.findIndex((p) => typeof p.type === 'string' && p.type.endsWith('[]'));
  return idx >= 0 ? idx : 0;
}

const K_PREFIX_OUTPUT = /^\s*\d+\s*,\s*\w+\s*=\s*\[/;

/**
 * Detect mutation/k-prefix grading from LeetCode metaData (+ examples for k-prefix).
 * Missing/unparseable metaData ⇒ undefined (return-value grading).
 */
export function detectJudge(
  metaDataRaw: string | null | undefined,
  examples?: Example[],
): Judge | undefined {
  const meta = parseMetaData(metaDataRaw);
  if (!meta) return undefined;
  const returnType = meta.return?.type;
  const params = meta.params ?? [];
  const argIndex = firstArrayArgIndex(params);
  const hasArrayParam = params.some((p) => typeof p.type === 'string' && p.type.endsWith('[]'));

  if (returnType === 'void') {
    return { kind: 'in-place', argIndex };
  }

  if (returnType === 'integer' && hasArrayParam) {
    const outs = examples ?? [];
    if (outs.some((ex) => typeof ex.output === 'string' && K_PREFIX_OUTPUT.test(ex.output))) {
      return { kind: 'k-prefix', argIndex };
    }
  }

  return undefined;
}

export async function fetchProblem(input: string): Promise<LeetCodeProblem> {
  const slug = slugFromUrl(input);
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://leetcode.com/problems/${slug}/`,
    },
    body: JSON.stringify({
      query:
        'query q($titleSlug: String!){ question(titleSlug:$titleSlug){ title titleSlug difficulty content metaData codeSnippets { lang langSlug code } } }',
      variables: { titleSlug: slug },
    }),
  });
  if (!res.ok) {
    throw new Error(`LeetCode GraphQL request failed with status ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: {
      question: null | {
        title: string;
        titleSlug: string;
        difficulty: string;
        content: string;
        metaData?: string | null;
        codeSnippets: CodeSnippet[] | null;
      };
    };
  };
  const question = json.data?.question;
  if (question == null) {
    throw new Error(`problem not found or premium-locked: ${slug}`);
  }
  const markdown = htmlToMarkdown(question.content);
  const { statementMd, constraintsMd } = splitStatement(markdown);
  const statement =
    `PROBLEM: ${question.title} (${question.difficulty})\n\n` + markdown;
  const metaData =
    typeof question.metaData === 'string' && question.metaData.trim()
      ? question.metaData
      : undefined;
  return {
    title: question.title,
    slug: question.titleSlug,
    difficulty: question.difficulty,
    url: `https://leetcode.com/problems/${question.titleSlug}/`,
    contentHtml: question.content,
    statement,
    statementMd,
    constraintsMd,
    codeSnippets: question.codeSnippets ?? [],
    ...(metaData ? { metaData } : {}),
  };
}
