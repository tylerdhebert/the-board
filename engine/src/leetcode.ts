export interface LeetCodeProblem {
  title: string;
  slug: string;
  difficulty: string;
  contentHtml: string; // raw HTML from LeetCode
  statement: string; // plain-text, ready to feed to ingest()
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
        'query q($titleSlug: String!){ question(titleSlug:$titleSlug){ title titleSlug difficulty content } }',
      variables: { titleSlug: slug },
    }),
  });
  if (!res.ok) {
    throw new Error(`LeetCode GraphQL request failed with status ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: { question: null | { title: string; titleSlug: string; difficulty: string; content: string } };
  };
  const question = json.data?.question;
  if (question == null) {
    throw new Error(`problem not found or premium-locked: ${slug}`);
  }
  const statement =
    `PROBLEM: ${question.title} (${question.difficulty})\n\n` + htmlToText(question.content);
  return {
    title: question.title,
    slug: question.titleSlug,
    difficulty: question.difficulty,
    contentHtml: question.content,
    statement,
  };
}
