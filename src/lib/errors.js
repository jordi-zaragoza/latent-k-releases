import {log} from './config.js';
export const ErrorCodes={NOT_CONFIGURED:100,INVALID_API_KEY:101,MISSING_API_KEY:102,LICENSE_REQUIRED:200,LICENSE_EXPIRED:201,LICENSE_INVALID:202,FILE_NOT_FOUND:300,PERMISSION_DENIED:301,DIRECTORY_NOT_FOUND:302,API_ERROR:400,API_RATE_LIMITED:401,API_TIMEOUT:402,API_INVALID_RESPONSE:403,CONTEXT_NOT_INITIALIZED:500,CONTEXT_CORRUPTED:501,CONTEXT_PARSE_ERROR:502,UNKNOWN_ERROR:999};
const ErrorMessages={[ErrorCodes.NOT_CONFIGURED]:'LK is not configured. Run: lk setup',[ErrorCodes.INVALID_API_KEY]:'Invalid API key. Run: lk setup to reconfigure',[ErrorCodes.MISSING_API_KEY]:'API key not found. Run: lk setup',[ErrorCodes.LICENSE_REQUIRED]:'License required. Run: lk activate',[ErrorCodes.LICENSE_EXPIRED]:'License expired. Please renew at https://latent-k.com',[ErrorCodes.LICENSE_INVALID]:'Invalid license. Run: lk activate with a valid key',[ErrorCodes.FILE_NOT_FOUND]:'File not found',[ErrorCodes.PERMISSION_DENIED]:'Permission denied',[ErrorCodes.DIRECTORY_NOT_FOUND]:'Directory not found',[ErrorCodes.API_ERROR]:'AI API error',[ErrorCodes.API_RATE_LIMITED]:'API rate limited. Please wait and try again',[ErrorCodes.API_TIMEOUT]:'API request timed out',[ErrorCodes.API_INVALID_RESPONSE]:'Invalid response from AI API',[ErrorCodes.CONTEXT_NOT_INITIALIZED]:'LK context not initialized. Run: lk sync',[ErrorCodes.CONTEXT_CORRUPTED]:'LK context is corrupted. Run: lk clean -c && lk sync',[ErrorCodes.CONTEXT_PARSE_ERROR]:'Failed to parse LK context',[ErrorCodes.UNKNOWN_ERROR]:'An unexpected error occurred'};
export class LKError extends Error {
  constructor(c, m = null, d = null) {
    const msg = m || ErrorMessages[c] || ErrorMessages[ErrorCodes.UNKNOWN_ERROR];
    super(msg);
    this.name = 'LKError';
    this.code = c;
    this.details = d;
    if (Error.captureStackTrace) Error.captureStackTrace(this, LKError);
  }
  toUserMessage() {
    let m = this.message;
    if (this.details) m += `: ${this.details}`;
    return m;
  }
  toLogInfo() {
    return {code:this.code,message:this.message,details:this.details,stack:this.stack};
  }
}
export function withErrorHandling(fn, opts = {}) {
  const {silent:sl = false, exitOnError:eo = false} = opts;
  return async (...a) => {
    try {
      return await fn(...a);
    } catch (e) {
      handleError(e, {silent:sl, exitOnError:eo});
    }
  };
}
export function handleError(e, opts = {}) {
  const {silent:sl = false, exitOnError:eo = false, context:ctx = ''} = opts;
  if (e instanceof LKError) log('ERROR', `[${e.code}] ${e.message}`, e.details || '');
  else log('ERROR', e.message, e.stack);
  if (!sl) {
    const pfx = ctx ? `${ctx}: ` : '';
    if (e instanceof LKError) console.error(`${pfx}${e.toUserMessage()}`);
    else console.error(`${pfx}${e.message}`);
  }
  if (eo) {
    const c = e instanceof LKError ? e.code : 1;
    process.exit(c);
  }
  return e;
}
export function createConfigError(msg = null) {return new LKError(ErrorCodes.NOT_CONFIGURED, msg);}
export function createApiKeyError(msg = null) {return new LKError(ErrorCodes.INVALID_API_KEY, msg);}
export function createLicenseError(c = ErrorCodes.LICENSE_REQUIRED, msg = null) {return new LKError(c, msg);}
export function createApiError(msg = null, d = null) {return new LKError(ErrorCodes.API_ERROR, msg, d);}
export function createFileError(c = ErrorCodes.FILE_NOT_FOUND, p = null) {return new LKError(c, null, p);}
export function createContextError(c = ErrorCodes.CONTEXT_NOT_INITIALIZED, msg = null) {return new LKError(c, msg);}
export async function withRetry(fn, opts = {}) {
  const {maxRetries:mr = 3, baseDelay:bd = 1000, maxDelay:md = 10000, retryOn:ro = [ErrorCodes.API_RATE_LIMITED, ErrorCodes.API_TIMEOUT]} = opts;
  let le;
  for (let i = 0; i <= mr; i++) {
    try {
      return await fn();
    } catch (e) {
      le = e;
      const sr = e instanceof LKError ? ro.includes(e.code) : false;
      if (!sr || i === mr) throw e;
      const d = Math.min(bd * Math.pow(2, i), md);
      log('ERROR', `Retry ${i + 1}/${mr} after ${d}ms`);
      await new Promise(r => setTimeout(r, d));
    }
  }
  throw le;
}
export function safeJsonParse(txt, fb = null) {
  try {
    return JSON.parse(txt);
  } catch {
    return fb;
  }
}
export function isErrorCode(e, c) {return e instanceof LKError && e.code === c;}