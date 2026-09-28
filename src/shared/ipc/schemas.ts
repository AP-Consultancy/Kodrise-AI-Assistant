import { z } from 'zod';

export const EmptyPayloadSchema = z.object({}).strict().optional();

export const CredentialsKeySchema = z
  .object({
    key: z.string().min(1).max(128),
  })
  .strict();

export const CredentialsSetSchema = z
  .object({
    key: z.string().min(1).max(128),
    value: z.string().min(1).max(8192),
  })
  .strict();

export const ClientSecurityReportSchema = z
  .object({
    preloadAvailable: z.boolean(),
    nodeRequirePresent: z.boolean(),
    companyAiApiPresent: z.boolean(),
  })
  .strict();

export const AudioDeviceInfoSchema = z
  .object({
    deviceId: z.string().min(1).max(256),
    label: z.string().max(256),
    groupId: z.string().max(256),
    isDefault: z.boolean(),
  })
  .strict();

export const AudioDevicesPayloadSchema = z
  .object({
    devices: z.array(AudioDeviceInfoSchema).max(64),
  })
  .strict();

export const AudioSelectDeviceSchema = z
  .object({
    deviceId: z.string().min(1).max(256).nullable(),
  })
  .strict();

export const AudioPermissionSchema = z
  .object({
    permission: z.enum(['required', 'granted', 'denied', 'unavailable', 'unknown']),
  })
  .strict();

export const AudioStartSchema = z
  .object({
    deviceId: z.string().min(1).max(256).optional(),
    sampleRate: z.number().int().min(8000).max(48000).optional(),
    channels: z.number().int().min(1).max(2).optional(),
  })
  .strict();

export const AudioChunkDtoSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
    dataBase64: z.string().min(1).max(2_000_000),
    sampleRate: z.number().int().min(8000).max(48000),
    channels: z.number().int().min(1).max(2),
    byteLength: z.number().int().positive().max(1_000_000),
    source: z.enum(['microphone', 'meeting_audio']).optional(),
  });

export const AudioInputModeSchema = z.enum([
  'microphone',
  'meeting_audio',
  'microphone_and_meeting',
]);

export const AudioInputSetModeSchema = z
  .object({
    mode: AudioInputModeSchema,
  })
  .strict();

export const AudioInputSelectDeviceSchema = z
  .object({
    role: z.enum(['microphone', 'meeting_audio']),
    deviceId: z.string().min(1).max(256).nullable(),
  })
  .strict();

export const AudioCaptureErrorSchema = z
  .object({
    message: z.string().min(1).max(500),
  })
  .strict();

export const TranscriptRecentSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .optional();

export const QuestionRecentSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .optional();

export const ContextRecentSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .optional();

export const AIGenerateSchema = z
  .object({
    questionId: z.string().min(1).max(128),
  })
  .strict();

export const AICancelSchema = z
  .object({
    requestId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .optional();

export const AITestConnectionSchema = z
  .object({
    provider: z.enum(['openai', 'mock', 'gemini']).optional(),
  })
  .strict()
  .optional();

export const CaptureApplyPolicySchema = z
  .object({
    policy: z.enum(['STANDARD', 'PRIVACY_AWARE', 'DISABLED']),
  })
  .strict();

export const VisualSetSourceSchema = z
  .object({
    source: z.enum(['DISPLAY', 'WINDOW', 'REGION', 'MANUAL_IMAGE', 'NONE']),
    sourceId: z.string().min(1).max(256).nullable().optional(),
  })
  .strict();

export const VisualCaptureNowSchema = z
  .object({
    sourceKind: z.enum(['DISPLAY', 'WINDOW', 'REGION', 'MANUAL_IMAGE', 'NONE']).optional(),
    sourceId: z.string().min(1).max(256).optional(),
    region: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1).max(7680),
        height: z.number().int().min(1).max(4320),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const VisualIntelligenceAnalyzeSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict()
  .optional();

export const VisualIntelligenceCancelSchema = z
  .object({
    requestId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .optional();

export const InterviewPickDocumentSchema = z
  .object({
    kind: z.enum(['resume', 'job_description', 'additional']),
  })
  .strict();

export const InterviewRemoveDocumentSchema = z
  .object({
    id: z.string().min(1).max(128),
  })
  .strict();

export const InterviewSubmitQuestionSchema = z
  .object({
    text: z.string().min(1).max(4000),
  })
  .strict();

const ProgrammingLanguageSchema = z.enum([
  'python',
  'java',
  'javascript',
  'typescript',
  'cpp',
  'csharp',
  'go',
  'rust',
  'kotlin',
  'php',
  'ruby',
  'swift',
  'unknown',
  'auto',
]);

const SqlDialectSchema = z.enum([
  'postgresql',
  'mysql',
  'sqlserver',
  'oracle',
  'sqlite',
  'generic',
  'unknown',
  'auto',
]);

export const ProblemCreateSchema = z
  .object({
    text: z.string().min(1).max(20_000),
    source: z
      .enum(['manual', 'simulation', 'visual_capture', 'document', 'pasted_text'])
      .optional(),
    language: ProgrammingLanguageSchema.optional(),
    sqlDialect: SqlDialectSchema.optional(),
    existingCode: z.string().max(50_000).nullable().optional(),
    existingSql: z.string().max(50_000).nullable().optional(),
    schema: z.string().max(50_000).nullable().optional(),
    sampleData: z.string().max(50_000).nullable().optional(),
    sessionLanguage: ProgrammingLanguageSchema.nullable().optional(),
  })
  .strict();

export const ProblemIdSchema = z
  .object({
    problemId: z.string().min(1).max(128),
  })
  .strict();

export const ProblemSelectLanguageSchema = z
  .object({
    problemId: z.string().min(1).max(128),
    language: z.enum([
      'python',
      'java',
      'javascript',
      'typescript',
      'cpp',
      'csharp',
      'go',
      'rust',
      'kotlin',
      'php',
      'ruby',
      'swift',
      'unknown',
    ]),
  })
  .strict();

export const ProblemSelectDialectSchema = z
  .object({
    problemId: z.string().min(1).max(128),
    dialect: z.enum([
      'postgresql',
      'mysql',
      'sqlserver',
      'oracle',
      'sqlite',
      'generic',
      'unknown',
    ]),
  })
  .strict();

export const ProblemReviseSchema = z
  .object({
    problemId: z.string().min(1).max(128),
    constraintDelta: z.string().min(1).max(4000),
    language: ProgrammingLanguageSchema.optional(),
    sqlDialect: SqlDialectSchema.optional(),
  })
  .strict();

export const ProblemExecuteSchema = z
  .object({
    problemId: z.string().min(1).max(128),
    mode: z.enum(['solution', 'existing', 'tests']).optional(),
  })
  .strict();

export const ProblemCancelExecutionSchema = z
  .object({
    executionId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .optional();

export const ProblemEventsLimitSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .optional();

export const QuestionCaptureUpdateSchema = z
  .object({
    hotkey: z.string().min(3).max(80).optional(),
    captureMode: z.enum(['region', 'active_window', 'full_screen']).optional(),
  })
  .strict();

export const QuestionCaptureSelectSchema = z
  .object({
    index: z.number().int().min(0).max(20),
  })
  .strict();

export type CredentialsKeyPayload = z.infer<typeof CredentialsKeySchema>;
export type CredentialsSetPayload = z.infer<typeof CredentialsSetSchema>;
export type ClientSecurityReportPayload = z.infer<typeof ClientSecurityReportSchema>;
