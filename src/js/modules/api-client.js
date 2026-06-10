// Shared API client instance. Lives outside app.js so lazily loaded modules
// can issue authenticated requests without importing the app entry module.
import { createAppApiClient } from './app-api-client.js';
import { getRealtimeSyncModule } from './app-state.js';

const appApiClient = createAppApiClient({
  getRealtimeSyncModuleInstance: getRealtimeSyncModule,
  logger: console,
});

export const apiCall = appApiClient.apiCall;
