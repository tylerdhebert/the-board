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
  contentHtml: string; // raw HTML from LeetCode
  statement: string; // plain-text, ready to feed to ingest()
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

export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
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
  const statement =
    `PROBLEM: ${question.title} (${question.difficulty})\n\n` + htmlToText(question.content);
  const metaData =
    typeof question.metaData === 'string' && question.metaData.trim()
      ? question.metaData
      : undefined;
  return {
    title: question.title,
    slug: question.titleSlug,
    difficulty: question.difficulty,
    contentHtml: question.content,
    statement,
    codeSnippets: question.codeSnippets ?? [],
    ...(metaData ? { metaData } : {}),
  };
}
