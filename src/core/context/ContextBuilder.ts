import type { DetectedQuestion } from '../../shared/questions/types';
import type { TranscriptSegment } from '../../shared/transcription/types';
import type {
  ContextBudget,
  ContextMetadata,
  ContextQuality,
  ContextSnapshot,
  ContextSourceKind,
  InterviewDocumentContext,
  ProjectContext,
  UserContext,
} from '../../shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../shared/context/types';
import type { VisualContextSnapshot } from '../../shared/visual-context/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import { TranscriptContextProvider } from './TranscriptContextProvider';
import { QuestionContextProvider } from './QuestionContextProvider';
import { ProjectContextProvider, UserContextProvider } from './UserProjectContextProviders';
import { ContextDeduplicator } from './ContextDeduplicator';
import {
  DocumentRelevanceSelector,
  type DocumentCandidate,
} from '../documents/DocumentRelevanceSelector';

export interface ContextBuildInput {
  currentQuestion: DetectedQuestion;
  transcriptSegments: TranscriptSegment[];
  questionHistory: DetectedQuestion[];
  userContext?: UserContext | null;
  projectContext?: ProjectContext | null;
  visualContext?: VisualContextSnapshot | null;
  interviewDocuments?: InterviewDocumentContext | null;
  sessionId?: string | null;
  correlationId?: string | null;
  budget?: ContextBudget;
}

/**
 * Collect → relate → dedupe → prioritize → budget → ContextSnapshot.
 */
export class ContextBuilder {
  private readonly transcriptProvider = new TranscriptContextProvider();
  private readonly questionProvider = new QuestionContextProvider();
  private readonly userProvider = new UserContextProvider();
  private readonly projectProvider = new ProjectContextProvider();
  private readonly deduplicator = new ContextDeduplicator();
  private readonly relevanceSelector = new DocumentRelevanceSelector();
  private readonly createId: IdGenerator;

  constructor(options?: { idGenerator?: IdGenerator }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
  }

  build(input: ContextBuildInput): ContextSnapshot {
    const budget = { ...DEFAULT_CONTEXT_BUDGET, ...input.budget };
    const sources: ContextSourceKind[] = ['session', 'question_history', 'transcript'];

    const questionWindow = this.questionProvider.select(
      input.currentQuestion,
      input.questionHistory,
      budget,
    );
    let relatedQuestions = this.deduplicator.dedupeQuestions(questionWindow.relatedQuestions);
    const recentQuestions = this.deduplicator.dedupeQuestions(questionWindow.recentQuestions);

    const transcriptWindow = this.transcriptProvider.selectRecent(input.transcriptSegments, budget);
    let recentTranscript = this.deduplicator.dedupeTranscript(transcriptWindow.segments);
    recentTranscript = this.deduplicator.removeTranscriptCoveredByQuestions(recentTranscript, [
      input.currentQuestion,
      ...relatedQuestions,
      ...recentQuestions,
    ]);

    const userContext = this.userProvider.get(input.userContext);
    const projectContext = this.projectProvider.get(input.projectContext);
    if (userContext) sources.push('user_context');
    if (projectContext) sources.push('project_context');

    const visualContext = this.prepareVisualContext(input.visualContext, budget);
    if (visualContext) sources.push('visual_context');

    const preparedDocs = this.prepareInterviewDocuments(
      input.interviewDocuments,
      budget,
      input.currentQuestion,
    );
    let interviewDocuments = preparedDocs.documents;
    let omittedDocumentExcerpts = preparedDocs.omitted;
    let documentTruncated = preparedDocs.documentTruncated;
    if (interviewDocuments) sources.push('interview_documents');

    let omittedTranscript = transcriptWindow.omittedCount;
    let omittedQuestions = questionWindow.omittedCount;
    let truncated =
      omittedTranscript > 0 || omittedQuestions > 0 || omittedDocumentExcerpts > 0 || documentTruncated;

    // Soft budget on total characters — drop older recent questions, then older transcript,
    // then additional docs, then OCR, then vision.
    const measure = () =>
      this.estimateCharacters(
        input.currentQuestion,
        relatedQuestions,
        recentQuestions,
        recentTranscript,
        userContext,
        projectContext,
        visualContext,
        interviewDocuments,
      );

    while (measure() > budget.maxContextCharacters && recentQuestions.length > 0) {
      recentQuestions.shift();
      omittedQuestions += 1;
      truncated = true;
    }
    while (measure() > budget.maxContextCharacters && recentTranscript.length > 0) {
      recentTranscript.shift();
      omittedTranscript += 1;
      truncated = true;
    }
    while (measure() > budget.maxContextCharacters && relatedQuestions.length > 1) {
      relatedQuestions = relatedQuestions.slice(0, -1);
      omittedQuestions += 1;
      truncated = true;
    }
    while (
      interviewDocuments &&
      measure() > budget.maxContextCharacters &&
      interviewDocuments.excerpts.length > 0
    ) {
      const removed = interviewDocuments.excerpts.pop();
      if (removed) {
        omittedDocumentExcerpts += 1;
        documentTruncated = true;
        truncated = true;
        interviewDocuments = this.rebuildInterviewContext(interviewDocuments.excerpts);
      }
    }
    while (
      visualContext &&
      measure() > budget.maxContextCharacters &&
      visualContext.ocrResults.length > 0
    ) {
      visualContext.ocrResults.shift();
      visualContext.metadata.ocrResultCount = visualContext.ocrResults.length;
      visualContext.metadata.truncated = true;
      truncated = true;
    }
    while (
      visualContext &&
      measure() > budget.maxContextCharacters &&
      visualContext.visionAnalyses.length > 1
    ) {
      visualContext.visionAnalyses.shift();
      visualContext.metadata.visionAnalysisCount = visualContext.visionAnalyses.length;
      visualContext.metadata.truncated = true;
      truncated = true;
    }

    const characterCount = measure();
    const metadata: ContextMetadata = {
      truncated: truncated || Boolean(visualContext?.metadata.truncated),
      omittedTranscriptSegments: omittedTranscript,
      omittedQuestions,
      omittedDocumentExcerpts,
      documentTruncated,
      sources,
      characterCount,
      budget,
      visualFrameCount: visualContext?.metadata.visualFrameCount ?? visualContext?.metadata.frameCount ?? 0,
      visualFramesDiscarded:
        visualContext?.metadata.discardedFrameCount ?? visualContext?.metadata.discardedCount ?? 0,
      visualTruncated: visualContext?.metadata.truncated ?? false,
      visualPayloadBytes:
        visualContext?.metadata.payloadBytes ?? visualContext?.metadata.approximatePayloadBytes ?? 0,
      ocrResultCount: visualContext?.metadata.ocrResultCount ?? 0,
      visionAnalysisCount: visualContext?.metadata.visionAnalysisCount ?? 0,
    };

    const quality = this.computeQuality({
      truncated: metadata.truncated,
      hasRelated: relatedQuestions.length > 0,
      expectsRelated: Boolean(
        input.currentQuestion.parentQuestionId || input.currentQuestion.relatedQuestionId,
      ),
      transcriptSelected: recentTranscript.length,
      transcriptAvailable: input.transcriptSegments.length,
      omittedTranscript,
    });

    return {
      id: this.createId(),
      sessionId: input.sessionId ?? null,
      correlationId: input.correlationId ?? null,
      questionId: input.currentQuestion.id,
      currentQuestion: structuredClone(input.currentQuestion),
      recentTranscript,
      recentQuestions,
      relatedQuestions,
      userContext,
      projectContext,
      visualContext,
      interviewDocuments,
      createdAt: Date.now(),
      metadata,
      quality,
    };
  }

  private rebuildInterviewContext(
    excerpts: InterviewDocumentContext['excerpts'],
  ): InterviewDocumentContext | null {
    if (excerpts.length === 0) return null;
    const resume = excerpts.find((item) => item.kind === 'resume') ?? null;
    const jd = excerpts.find((item) => item.kind === 'job_description') ?? null;
    const additional = excerpts.filter((item) => item.kind === 'additional');
    return {
      excerpts,
      resumeExcerpt: resume?.text ?? null,
      jobDescriptionExcerpt: jd?.text ?? null,
      additionalExcerpts: additional.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        text: item.text,
        truncated: item.truncated,
        relevanceScore: item.relevanceScore,
        relevanceReason: item.relevanceReason,
      })),
    };
  }

  private prepareInterviewDocuments(
    input: InterviewDocumentContext | null | undefined,
    budget: ContextBudget,
    question: DetectedQuestion,
  ): { documents: InterviewDocumentContext | null; omitted: number; documentTruncated: boolean } {
    if (!input) return { documents: null, omitted: 0, documentTruncated: false };

    const candidates = this.collectCandidates(input);
    if (candidates.length === 0) {
      return { documents: null, omitted: 0, documentTruncated: false };
    }

    const maxCharsPerExcerpt = Math.min(1200, Math.floor(budget.maxContextCharacters * 0.2));
    const selected = this.relevanceSelector.select({
      question,
      documents: candidates,
      maxExcerpts: 4,
      maxCharsPerExcerpt,
    });

    const omitted = Math.max(0, candidates.length - selected.excerpts.length);
    const documentTruncated = selected.excerpts.some((item) => item.truncated);
    const hasContent = selected.excerpts.length > 0;
    return {
      documents: hasContent ? selected : null,
      omitted,
      documentTruncated,
    };
  }

  private collectCandidates(input: InterviewDocumentContext): DocumentCandidate[] {
    if (input.excerpts?.length) {
      return input.excerpts.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        kind: item.kind,
        text: item.text,
        truncated: item.truncated,
      }));
    }

    const candidates: DocumentCandidate[] = [];
    if (input.resumeExcerpt) {
      candidates.push({
        id: 'resume',
        fileName: 'resume',
        kind: 'resume',
        text: input.resumeExcerpt,
        truncated: false,
      });
    }
    if (input.jobDescriptionExcerpt) {
      candidates.push({
        id: 'job_description',
        fileName: 'job_description',
        kind: 'job_description',
        text: input.jobDescriptionExcerpt,
        truncated: false,
      });
    }
    for (const [index, item] of (input.additionalExcerpts ?? []).entries()) {
      candidates.push({
        id: item.id ?? `additional-${index}`,
        fileName: item.fileName,
        kind: 'additional',
        text: item.text,
        truncated: Boolean(item.truncated),
      });
    }
    return candidates;
  }

  private prepareVisualContext(
    input: VisualContextSnapshot | null | undefined,
    budget: ContextBudget,
  ): VisualContextSnapshot | null {
    if (!input) return null;
    const hasContent =
      input.frames.length > 0 ||
      (input.ocrResults?.length ?? 0) > 0 ||
      (input.visionAnalyses?.length ?? 0) > 0;
    if (!hasContent) return null;

    const clone = structuredClone(input);
    clone.ocrResults = clone.ocrResults ?? [];
    clone.visionAnalyses = clone.visionAnalyses ?? [];

    // Deduplicate OCR text already covered by vision relevantText.
    const visionText = clone.visionAnalyses.map((item) => item.relevantText).join('\n');
    clone.ocrResults = clone.ocrResults.filter((ocr) => {
      if (!ocr.text) return false;
      const sample = ocr.text.slice(0, 80);
      return !sample || !visionText.includes(sample);
    });

    // Bound OCR characters relative to remaining budget share.
    const maxOcrChars = Math.min(2000, Math.floor(budget.maxContextCharacters * 0.25));
    let ocrUsed = 0;
    clone.ocrResults = clone.ocrResults.filter((ocr) => {
      if (ocrUsed >= maxOcrChars) return false;
      if (ocr.text.length + ocrUsed > maxOcrChars) {
        ocr.text = `${ocr.text.slice(0, Math.max(0, maxOcrChars - ocrUsed))}\n…[ocr truncated]`;
      }
      ocrUsed += ocr.text.length;
      return true;
    });

    while (clone.visionAnalyses.length > 2) {
      clone.visionAnalyses.shift();
      clone.metadata.truncated = true;
    }

    clone.metadata = {
      ...clone.metadata,
      visualFrameCount: clone.frames.length,
      ocrResultCount: clone.ocrResults.length,
      visionAnalysisCount: clone.visionAnalyses.length,
      discardedFrameCount: clone.metadata.discardedFrameCount ?? clone.metadata.discardedCount,
      payloadBytes: clone.metadata.payloadBytes ?? clone.metadata.approximatePayloadBytes,
    };
    return clone;
  }

  private estimateCharacters(
    current: DetectedQuestion,
    related: DetectedQuestion[],
    recent: DetectedQuestion[],
    transcript: TranscriptSegment[],
    user: UserContext | null,
    project: ProjectContext | null,
    visual: VisualContextSnapshot | null = null,
    interview: InterviewDocumentContext | null = null,
  ): number {
    let total = current.text.length;
    for (const question of related) total += question.text.length;
    for (const question of recent) total += question.text.length;
    for (const segment of transcript) total += segment.text.length;
    if (user) total += JSON.stringify(user).length;
    if (project) total += JSON.stringify(project).length;
    if (visual) {
      for (const analysis of visual.visionAnalyses ?? []) {
        total += analysis.description.length + analysis.relevantText.length;
        for (const element of analysis.technicalElements) {
          total += element.value.length + element.kind.length;
        }
      }
      for (const ocr of visual.ocrResults ?? []) {
        total += ocr.text.length;
      }
    }
    if (interview) {
      if (interview.excerpts?.length) {
        for (const excerpt of interview.excerpts) {
          total += excerpt.text.length + excerpt.fileName.length;
        }
      } else {
        if (interview.resumeExcerpt) total += interview.resumeExcerpt.length;
        if (interview.jobDescriptionExcerpt) total += interview.jobDescriptionExcerpt.length;
        for (const extra of interview.additionalExcerpts) {
          total += extra.text.length + extra.fileName.length;
        }
      }
    }
    return total;
  }

  private computeQuality(input: {
    truncated: boolean;
    hasRelated: boolean;
    expectsRelated: boolean;
    transcriptSelected: number;
    transcriptAvailable: number;
    omittedTranscript: number;
  }): ContextQuality {
    const transcriptCoverage =
      input.transcriptAvailable === 0
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              input.transcriptSelected /
                Math.max(1, input.transcriptSelected + input.omittedTranscript),
            ),
          );
    const relationshipCoverage = input.expectsRelated ? (input.hasRelated ? 1 : 0) : 1;
    const completeness = Number(
      (
        (input.truncated ? 0.7 : 1) * 0.4 +
        transcriptCoverage * 0.35 +
        relationshipCoverage * 0.25
      ).toFixed(3),
    );

    return {
      completeness,
      transcriptCoverage: Number(transcriptCoverage.toFixed(3)),
      relationshipCoverage,
      truncated: input.truncated,
    };
  }
}
