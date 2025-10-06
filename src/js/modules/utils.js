import { showToast as appShowToast, apiCall as appApiCall } from '../app.js';

export const showToast = appShowToast;
export const apiCall = appApiCall;

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
