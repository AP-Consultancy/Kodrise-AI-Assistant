import { describe, expect, it } from 'vitest';
import { InterviewSessionContextStore } from '../../src/core/interview/InterviewSessionContextStore';
import { TextDocumentExtractor, detectFormat, CompositeDocumentExtractor } from '../../src/core/documents';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import { AppError } from '../../src/shared/errors';
import {
  InterviewPickDocumentSchema,
  InterviewSubmitQuestionSchema,
} from '../../src/shared/ipc/schemas';
import { INTERVIEW_UI_STATE_LABELS } from '../../src/shared/interview/types';
import type { DetectedQuestion } from '../../src/shared/questions/types';

function question(text: string): DetectedQuestion {
  return {
    id: 'q1',
    text,
    originalText: text,
    normalizedText: text.toLowerCase(),
    type: 'technical',
    status: 'classified',
    timestamp: Date.now(),
    sourceSegmentIds: ['manual'],
    detectionConfidence: 0.9,
    classificationConfidence: 0.85,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
  };
}

describe('Document extraction', () => {
  it('detects formats and extracts text/md', async () => {
    expect(detectFormat('resume.txt', 'text/plain')).toBe('txt');
    expect(detectFormat('notes.md', null)).toBe('md');
    expect(detectFormat('photo.png', null)).toBe('unsupported');

    const extractor = new TextDocumentExtractor();
    const result = await extractor.extract({
      fileName: 'resume.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('Yash Tiwari\nSenior Developer'),
    });
    expect(result.format).toBe('txt');
    expect(result.text).toContain('Yash Tiwari');
  });

  it('rejects unsupported types via composite extractor', async () => {
    const extractor = new CompositeDocumentExtractor([new TextDocumentExtractor()]);
    const result = await extractor.extract({
      fileName: 'image.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.format).toBe('unsupported');
    expect(result.unsupportedReason).toMatch(/supported/i);
  });
});

describe('InterviewSessionContextStore', () => {
  it('uploads resume, additional docs, removes, and bounds text', async () => {
    const store = new InterviewSessionContextStore({
      extractor: new TextDocumentExtractor(),
      limits: {
        maxResumeCharacters: 40,
        maxJobDescriptionCharacters: 40,
        maxAdditionalCharactersPerDoc: 40,
        maxAdditionalDocuments: 2,
        maxFileBytes: 1_000_000,
      },
    });

    const resume = await store.addDocument({
      kind: 'resume',
      fileName: 'resume.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('A'.repeat(100)),
    });
    expect(resume.fileName).toBe('resume.txt');
    expect(resume.truncated).toBe(true);

    await store.addDocument({
      kind: 'additional',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('Project notes'),
    });

    expect(store.getPublic().documentCount).toBe(2);
    store.removeDocument(resume.id);
    expect(store.getPublic().resume).toBeNull();
    expect(store.getContext().additionalExcerpts[0]?.fileName).toBe('notes.txt');
  });

  it('throws a clear error for unsupported files', async () => {
    const store = new InterviewSessionContextStore({
      extractor: new CompositeDocumentExtractor([new TextDocumentExtractor()]),
    });
    await expect(
      store.addDocument({
        kind: 'resume',
        fileName: 'scan.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('Manual question pipeline', () => {
  it('processes pasted questions through QuestionManager', () => {
    const manager = new QuestionManager({ idGenerator: () => 'manual-q' });
    manager.setEnabled(true);
    const produced = manager.processManualText('Tell me about authentication');
    expect(produced.length).toBeGreaterThan(0);
    expect(produced[0]?.text).toContain('authentication');
    expect(manager.getCurrent()?.id).toBe(produced[0]?.id);
  });
});

describe('Interview document context integration', () => {
  it('includes resume and JD excerpts in context snapshots', () => {
    const builder = new ContextBuilder({ idGenerator: () => 'ctx-interview' });
    const snapshot = builder.build({
      currentQuestion: question('Tell me about your previous project.'),
      questionHistory: [],
      transcriptSegments: [],
      interviewDocuments: {
        excerpts: [
          {
            id: 'resume-1',
            fileName: 'resume.txt',
            kind: 'resume',
            text: 'Built Electron desktop assistants at AP Consultancy.',
            relevanceScore: 1,
            relevanceReason: 'test',
            truncated: false,
          },
          {
            id: 'jd-1',
            fileName: 'jd.txt',
            kind: 'job_description',
            text: 'Looking for senior TypeScript engineers.',
            relevanceScore: 1,
            relevanceReason: 'test',
            truncated: false,
          },
          {
            id: 'notes-1',
            fileName: 'notes.txt',
            kind: 'additional',
            text: 'Focus on auth and streaming.',
            relevanceScore: 1,
            relevanceReason: 'test',
            truncated: false,
          },
        ],
        resumeExcerpt: 'Built Electron desktop assistants at AP Consultancy.',
        jobDescriptionExcerpt: 'Looking for senior TypeScript engineers.',
        additionalExcerpts: [{ fileName: 'notes.txt', text: 'Focus on auth and streaming.' }],
      },
    });
    expect(snapshot.interviewDocuments?.resumeExcerpt).toContain('Electron');
    expect(snapshot.metadata.sources).toContain('interview_documents');
  });
});

describe('Interview IPC contracts and labels', () => {
  it('validates pick/submit payloads', () => {
    expect(InterviewPickDocumentSchema.safeParse({ kind: 'resume' }).success).toBe(true);
    expect(InterviewPickDocumentSchema.safeParse({ kind: 'camera' }).success).toBe(false);
    expect(InterviewSubmitQuestionSchema.safeParse({ text: 'Why React?' }).success).toBe(true);
    expect(InterviewSubmitQuestionSchema.safeParse({ text: '' }).success).toBe(false);
  });

  it('exposes user-friendly state labels', () => {
    expect(INTERVIEW_UI_STATE_LABELS.generating).toBe('Generating answer');
    expect(INTERVIEW_UI_STATE_LABELS.analyzing_visual).toBe('Checking visual context');
    expect(INTERVIEW_UI_STATE_LABELS.question_detected).toBe('Question detected');
  });
});
