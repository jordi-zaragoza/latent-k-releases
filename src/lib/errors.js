/**
 * Centralized error handling for LK CLI
 * Provides consistent error types, codes, and user-friendly messages
 */

import { log } from './config.js'

// Error codes for scripting/automation
export const ErrorCodes = {
  // Configuration errors (1xx)
  NOT_CONFIGURED: 100,
  INVALID_API_KEY: 101,
  MISSING_API_KEY: 102,

  // License errors (2xx)
  LICENSE_REQUIRED: 200,
  LICENSE_EXPIRED: 201,
  LICENSE_INVALID: 202,

  // File system errors (3xx)
  FILE_NOT_FOUND: 300,
  PERMISSION_DENIED: 301,
  DIRECTORY_NOT_FOUND: 302,

  // AI/API errors (4xx)
  API_ERROR: 400,
  API_RATE_LIMITED: 401,
  API_TIMEOUT: 402,
  API_INVALID_RESPONSE: 403,

  // Context errors (5xx)
  CONTEXT_NOT_INITIALIZED: 500,
  CONTEXT_CORRUPTED: 501,
  CONTEXT_PARSE_ERROR: 502,

  // General errors (9xx)
  UNKNOWN_ERROR: 999
}

// User-friendly error messages
const ErrorMessages = {
  [ErrorCodes.NOT_CONFIGURED]: 'LK is not configured. Run: lk setup',
  [ErrorCodes.INVALID_API_KEY]: 'Invalid API key. Run: lk setup to reconfigure',
  [ErrorCodes.MISSING_API_KEY]: 'API key not found. Run: lk setup',
  [ErrorCodes.LICENSE_REQUIRED]: 'License required. Run: lk activate',
  [ErrorCodes.LICENSE_EXPIRED]: 'License expired. Please renew at https://latent-k.com',
  [ErrorCodes.LICENSE_INVALID]: 'Invalid license. Run: lk activate with a valid key',
  [ErrorCodes.FILE_NOT_FOUND]: 'File not found',
  [ErrorCodes.PERMISSION_DENIED]: 'Permission denied',
  [ErrorCodes.DIRECTORY_NOT_FOUND]: 'Directory not found',
  [ErrorCodes.API_ERROR]: 'AI API error',
  [ErrorCodes.API_RATE_LIMITED]: 'API rate limited. Please wait and try again',
  [ErrorCodes.API_TIMEOUT]: 'API request timed out',
  [ErrorCodes.API_INVALID_RESPONSE]: 'Invalid response from AI API',
  [ErrorCodes.CONTEXT_NOT_INITIALIZED]: 'LK context not initialized. Run: lk sync',
  [ErrorCodes.CONTEXT_CORRUPTED]: 'LK context is corrupted. Run: lk clean -c && lk sync',
  [ErrorCodes.CONTEXT_PARSE_ERROR]: 'Failed to parse LK context',
  [ErrorCodes.UNKNOWN_ERROR]: 'An unexpected error occurred'
}

/**
 * Custom error class for LK errors
 */
export class LKError extends Error {
  constructor(code, message = null, details = null) {
    const msg = message || ErrorMessages[code] || ErrorMessages[ErrorCodes.UNKNOWN_ERROR]
    super(msg)

    this.name = 'LKError'
    this.code = code
    this.details = details

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LKError)
    }
  }

  /**
   * Get a user-friendly error message
   */
  toUserMessage() {
    let msg = this.message
    if (this.details) {
      msg += `: ${this.details}`
    }
    return msg
  }

  /**
   * Get error info for logging
   */
  toLogInfo() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * Wrap an async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Options
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn, options = {}) {
  const { silent = false, exitOnError = false } = options

  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      handleError(error, { silent, exitOnError })
    }
  }
}

/**
 * Handle an error with logging and optional exit
 * @param {Error} error - The error to handle
 * @param {Object} options - Options
 */
export function handleError(error, options = {}) {
  const { silent = false, exitOnError = false, context = '' } = options

  // Log the error
  if (error instanceof LKError) {
    log('ERROR', `[${error.code}] ${error.message}`, error.details || '')
  } else {
    log('ERROR', error.message, error.stack)
  }

  // Print user message unless silent
  if (!silent) {
    const prefix = context ? `${context}: ` : ''
    if (error instanceof LKError) {
      console.error(`${prefix}${error.toUserMessage()}`)
    } else {
      console.error(`${prefix}${error.message}`)
    }
  }

  // Exit if requested
  if (exitOnError) {
    const code = error instanceof LKError ? error.code : 1
    process.exit(code)
  }

  return error
}

/**
 * Create specific error types for common scenarios
 */
export function createConfigError(message = null) {
  return new LKError(ErrorCodes.NOT_CONFIGURED, message)
}

export function createApiKeyError(message = null) {
  return new LKError(ErrorCodes.INVALID_API_KEY, message)
}

export function createLicenseError(code = ErrorCodes.LICENSE_REQUIRED, message = null) {
  return new LKError(code, message)
}

export function createApiError(message = null, details = null) {
  return new LKError(ErrorCodes.API_ERROR, message, details)
}

export function createFileError(code = ErrorCodes.FILE_NOT_FOUND, path = null) {
  return new LKError(code, null, path)
}

export function createContextError(code = ErrorCodes.CONTEXT_NOT_INITIALIZED, message = null) {
  return new LKError(code, message)
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of the function
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    retryOn = [ErrorCodes.API_RATE_LIMITED, ErrorCodes.API_TIMEOUT]
  } = options

  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Check if we should retry
      const shouldRetry = error instanceof LKError
        ? retryOn.includes(error.code)
        : false

      if (!shouldRetry || attempt === maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      log('ERROR', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Safe wrapper for JSON parsing
 * @param {string} text - Text to parse
 * @param {*} fallback - Fallback value on error
 * @returns {*} Parsed JSON or fallback
 */
export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/**
 * Check if error is a specific LK error code
 */
export function isErrorCode(error, code) {
  return error instanceof LKError && error.code === code
}
