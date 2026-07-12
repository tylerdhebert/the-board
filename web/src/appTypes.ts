export type Mode = 'socratic' | 'analog' | 'scaffold'
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
  /** Stashed from turn; validated/activated after reveal (ephemeral). */
  gesture?: TeacherGesture
  /** Ephemeral fill-ins for scaffold ____ holes (not persisted). */
  blanks?: string[]
  sentBack?: boolean
}

export type CardState = {
  input: string
  expected: string
  got?: string
  error?: string
  pass?: boolean
}

export type ScaffoldSeg = { kind: 'prose' | 'code'; text: string }
