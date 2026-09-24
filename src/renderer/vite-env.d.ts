/// <reference types="vite/client" />

import type { CompanyAiApi } from '../shared/ipc/types';

declare global {
  interface Window {
    companyAI: CompanyAiApi;
  }
}

export {};
