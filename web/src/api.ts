export interface CodeSnippet {
  lang: string
  langSlug: string
  code: string
}

export interface Problem {
  title: string
  statement: string
  constraints: string
  codeSnippets?: CodeSnippet[]
}

export interface CardRef {
  name: string
  title: string
}

export interface TurnResult {
  reply: string
  mode: 'socratic' | 'analog' | 'scaffold'
  unlockedThisTurn: string[]
  redrafted: boolean
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getCards(): Promise<CardRef[]> {
  return request<CardRef[]>('/api/cards')
}

export async function createSession(
  cardName: string,
): Promise<{ sessionId: string; problem: Problem }> {
  return request<{ sessionId: string; problem: Problem }>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ cardName }),
  })
}

export type TurnStage = 'unlock' | 'draft' | 'gate' | 'redraft'

export async function submitTurn(
  sessionId: string,
  message: string,
  onStage?: (stage: TurnStage) => void,
): Promise<TurnResult> {
  const res = await fetch(`/api/session/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      if (!frame.trim()) continue
      let event = ''
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data = line.slice(6)
      }
      if (!event || !data) continue
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (event === 'stage') {
        onStage?.(parsed.stage as TurnStage)
      } else if (event === 'result') {
        return parsed as unknown as TurnResult
      } else if (event === 'error') {
        throw new Error(String(parsed.error))
      }
    }
  }
  throw new Error('Stream ended without result')
}

// New flow: hand the tutor a problem name or a LeetCode link; the server fetches
// + ingests it on the fly (slow on a cache miss).
export async function startSession(
  query: string,
): Promise<{ sessionId: string; problem: Problem; cached?: boolean }> {
  return request<{ sessionId: string; problem: Problem; cached?: boolean }>(
    '/api/start',
    { method: 'POST', body: JSON.stringify({ query }) },
  )
}

export type RunCaseResult = {
  display: string
  expected: string
  got: string
  pass: boolean
  error?: string
}

export type StudentRunResult = { cases: RunCaseResult[]; error?: string }

export async function runExamples(
  sessionId: string,
  code: string,
  language: string,
): Promise<StudentRunResult> {
  return request<StudentRunResult>(`/api/session/${sessionId}/run`, {
    method: 'POST',
    body: JSON.stringify({ code, language }),
  })
}
