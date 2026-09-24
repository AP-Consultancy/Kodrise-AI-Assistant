export type AppErrorCode =
  | 'VALIDATION'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'NETWORK'
  | 'PROVIDER'
  | 'POLICY_DENIED'
  | 'CONFIGURATION'
  | 'SESSION'
  | 'AUDIO_PERMISSION'
  | 'AUDIO_DEVICE'
  | 'AUDIO_CAPTURE'
  | 'AUDIO_FORMAT'
  | 'STT_CONNECTION'
  | 'STT_AUTHENTICATION'
  | 'STT_CONFIGURATION'
  | 'STT_TIMEOUT'
  | 'STT_PROVIDER'
  | 'STT_AUDIO_FORMAT'
  | 'INTERNAL';

export interface SafeErrorPayload {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
  recoverable?: boolean;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;
  readonly exposeToRenderer: boolean;
  readonly recoverable: boolean;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      exposeToRenderer?: boolean;
      cause?: unknown;
      recoverable?: boolean;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.details = options?.details;
    this.exposeToRenderer = options?.exposeToRenderer ?? true;
    this.recoverable = options?.recoverable ?? false;
  }

  toSafePayload(): SafeErrorPayload {
    return {
      code: this.code,
      message: this.exposeToRenderer ? this.message : 'An unexpected error occurred',
      details: this.exposeToRenderer ? this.details : undefined,
      recoverable: this.recoverable,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION', message, { details });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super('AUTHENTICATION', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Not authorized') {
    super('AUTHORIZATION', message);
    this.name = 'AuthorizationError';
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Network request failed') {
    super('NETWORK', message, { recoverable: true });
    this.name = 'NetworkError';
  }
}

export class ProviderError extends AppError {
  constructor(message = 'AI provider error') {
    super('PROVIDER', message);
    this.name = 'ProviderError';
  }
}

export class PolicyDeniedError extends AppError {
  constructor(message = 'Action denied by policy') {
    super('POLICY_DENIED', message);
    this.name = 'PolicyDeniedError';
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFIGURATION', message, { details });
    this.name = 'ConfigurationError';
  }
}

export class SessionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SESSION', message, { details });
    this.name = 'SessionError';
  }
}

export class AudioPermissionError extends AppError {
  constructor(message = 'Microphone permission denied or unavailable') {
    super('AUDIO_PERMISSION', message);
    this.name = 'AudioPermissionError';
  }
}

export class AudioDeviceError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AUDIO_DEVICE', message, { details });
    this.name = 'AudioDeviceError';
  }
}

export class AudioCaptureError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AUDIO_CAPTURE', message, { details });
    this.name = 'AudioCaptureError';
  }
}

export class AudioFormatError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AUDIO_FORMAT', message, { details });
    this.name = 'AudioFormatError';
  }
}

export class STTConnectionError extends AppError {
  constructor(message = 'Speech-to-text connection failed', recoverable = true) {
    super('STT_CONNECTION', message, { recoverable });
    this.name = 'STTConnectionError';
  }
}

export class STTAuthenticationError extends AppError {
  constructor(message = 'Speech-to-text authentication failed') {
    super('STT_AUTHENTICATION', message, { recoverable: false });
    this.name = 'STTAuthenticationError';
  }
}

export class STTConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('STT_CONFIGURATION', message, { details, recoverable: false });
    this.name = 'STTConfigurationError';
  }
}

export class STTTimeoutError extends AppError {
  constructor(message = 'Speech-to-text connection timed out') {
    super('STT_TIMEOUT', message, { recoverable: true });
    this.name = 'STTTimeoutError';
  }
}

export class STTProviderError extends AppError {
  constructor(message: string, recoverable = false) {
    super('STT_PROVIDER', message, { recoverable });
    this.name = 'STTProviderError';
  }
}

export class STTAudioFormatError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('STT_AUDIO_FORMAT', message, { details, recoverable: false });
    this.name = 'STTAudioFormatError';
  }
}

export function toSafeErrorPayload(error: unknown): SafeErrorPayload {
  if (error instanceof AppError) {
    return error.toSafePayload();
  }

  return {
    code: 'INTERNAL',
    message: 'An unexpected error occurred',
    recoverable: false,
  };
}
