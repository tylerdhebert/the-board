export interface Problem {
  title: string
  statement: string
  constraints: string
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

export async function submitTurn(
  sessionId: string,
  message: string,
): Promise<TurnResult> {
  return request<TurnResult>(`/api/session/${sessionId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}
