import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripFigureRefs } from './leetcode.js';
import type { LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate, renderTranscript } from './render.js';
import { renderCases, type TeacherTurnContext } from './teacher.js';
import type { Message, ProblemCard, TutorMode } from './types.js';

export interface TutorArtifact {
  title: string;
  html: string;
}

function unwrapHtmlFence(output: string): string {
  let html = output.trim();
  html = html.replace(/^```(?:html)?\s*\r?\n?/i, '');
  html = html.replace(/\r?\n?```\s*$/, '');
  return html.trim();
}

export function isStandaloneArtifactHtml(html: string): boolean {
  return /^(?:<!doctype\s+html\b|<html\b)/i.test(html)
    && Buffer.byteLength(html, 'utf8') <= 200 * 1024;
}

export function artifactTextForGate(title: string, html: string): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return `${title}\n${text}`;
}

export async function artifactTurn(
  client: LLMClient,
  card: ProblemCard,
  transcript: Message[],
  lockedTerms: string[],
  model: string,
  mode: TutorMode,
  concept: string,
  turnContext?: TeacherTurnContext,
): Promise<TutorArtifact | undefined> {
  const tpl = await readFile(join(PROMPTS_DIR, 'artifact_tmpl.md'), 'utf-8');
  const prompt = fillTemplate(tpl, {
    title: card.title,
    statement: stripFigureRefs(card.statement),
    constraints: card.constraints,
    cases: renderCases(card),
    mode,
    leak_terms: bullets(lockedTerms),
    concept,
    board_context: turnContext?.boardContext?.trim() ?? '(none)',
    transcript: renderTranscript(transcript),
    language: turnContext?.language ?? "the student's current language",
  });
  const output = await client.complete({
    model,
    prompt,
    label: 'artifact',
    ...(turnContext?.cwd ? { cwd: turnContext.cwd } : {}),
  });
  const html = unwrapHtmlFence(output);
  return isStandaloneArtifactHtml(html) ? { title: concept, html } : undefined;
}
