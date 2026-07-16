export type Mode = 'socratic' | 'analog' | 'scaffold' | 'direct'
export type TeacherGesture =
  | { kind: 'point'; line: number; endLine?: number; quote: string }
  | { kind: 'show'; caseNumber: number }
  | { kind: 'tap' }
export type Note = {
  role: 'student' | 'tutor'
  text: string
  mode?: Mode
  unlocked?: string[]
  redrafted?: boolean
  revealing?: boolean
  /** Accepted gesture carried with the tutor note; live effects remain ephemeral. */
  gesture?: TeacherGesture
  /** Saved fill-ins for scaffold ____ holes. */
  blanks?: string[]
  sentBack?: boolean
  artifact?: { title: string; file: string; url?: string }
  /** Hydrated from a save — render settled, replay no arrival animations. */
  restored?: boolean
  /** SHOW card expanded in the chat (ephemeral display state). */
  cardOpen?: boolean
}

export type CardState = {
  input: string
  expected: string
  got?: string
  error?: string
  pass?: boolean
}

export type ScaffoldSeg = { kind: 'prose' | 'code'; text: string }
