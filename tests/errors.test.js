import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ErrorCodes,
  LKError,
  withErrorHandling,
  handleError,
  createConfigError,
  createApiKeyError,
  createLicenseError,
  createApiError,
  createFileError,
  createContextError,
  withRetry,
  safeJsonParse,
  isErrorCode
} from '../src/lib/errors.js'

// Mock config.js
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

describe('ErrorCodes', () => {
  it('has configuration error codes', () => {
    expect(ErrorCodes.NOT_CONFIGURED).toBe(100)
    expect(ErrorCodes.INVALID_API_KEY).toBe(101)
    expect(ErrorCodes.MISSING_API_KEY).toBe(102)
  })

  it('has license error codes', () => {
    expect(ErrorCodes.LICENSE_REQUIRED).toBe(200)
    expect(ErrorCodes.LICENSE_EXPIRED).toBe(201)
    expect(ErrorCodes.LICENSE_INVALID).toBe(202)
  })

  it('has file system error codes', () => {
    expect(ErrorCodes.FILE_NOT_FOUND).toBe(300)
    expect(ErrorCodes.PERMISSION_DENIED).toBe(301)
    expect(ErrorCodes.DIRECTORY_NOT_FOUND).toBe(302)
  })

  it('has API error codes', () => {
    expect(ErrorCodes.API_ERROR).toBe(400)
    expect(ErrorCodes.API_RATE_LIMITED).toBe(401)
    expect(ErrorCodes.API_TIMEOUT).toBe(402)
  })

  it('has context error codes', () => {
    expect(ErrorCodes.CONTEXT_NOT_INITIALIZED).toBe(500)
    expect(ErrorCodes.CONTEXT_CORRUPTED).toBe(501)
  })

  it('has unknown error code', () => {
    expect(ErrorCodes.UNKNOWN_ERROR).toBe(999)
  })
})

describe('LKError', () => {
  it('creates error with code', () => {
    const error = new LKError(ErrorCodes.NOT_CONFIGURED)
    expect(error.code).toBe(ErrorCodes.NOT_CONFIGURED)
    expect(error.name).toBe('LKError')
    expect(error.message).toContain('not configured')
  })

  it('creates error with custom message', () => {
    const error = new LKError(ErrorCodes.API_ERROR, 'Custom error message')
    expect(error.message).toBe('Custom error message')
    expect(error.code).toBe(ErrorCodes.API_ERROR)
  })

  it('creates error with details', () => {
    const error = new LKError(ErrorCodes.FILE_NOT_FOUND, null, '/path/to/file')
    expect(error.details).toBe('/path/to/file')
  })

  it('toUserMessage returns formatted message', () => {
    const error = new LKError(ErrorCodes.FILE_NOT_FOUND, 'File not found', '/path/to/file')
    expect(error.toUserMessage()).toBe('File not found: /path/to/file')
  })

  it('toUserMessage without details does not append details', () => {
    const error = new LKError(ErrorCodes.NOT_CONFIGURED)
    const msg = error.toUserMessage()
    // Message should not have ": <details>" appended (but may contain : in the message itself)
    expect(error.details).toBeNull()
    expect(msg).toBe(error.message)
  })

  it('toLogInfo returns structured info', () => {
    const error = new LKError(ErrorCodes.API_ERROR, 'API failed', 'timeout')
    const info = error.toLogInfo()

    expect(info.code).toBe(ErrorCodes.API_ERROR)
    expect(info.message).toBe('API failed')
    expect(info.details).toBe('timeout')
    expect(info.stack).toBeTruthy()
  })

  it('is instance of Error', () => {
    const error = new LKError(ErrorCodes.UNKNOWN_ERROR)
    expect(error instanceof Error).toBe(true)
    expect(error instanceof LKError).toBe(true)
  })
})

describe('factory functions', () => {
  it('createConfigError creates NOT_CONFIGURED error', () => {
    const error = createConfigError()
    expect(error.code).toBe(ErrorCodes.NOT_CONFIGURED)
  })

  it('createConfigError with custom message', () => {
    const error = createConfigError('Custom config error')
    expect(error.message).toBe('Custom config error')
  })

  it('createApiKeyError creates INVALID_API_KEY error', () => {
    const error = createApiKeyError()
    expect(error.code).toBe(ErrorCodes.INVALID_API_KEY)
  })

  it('createLicenseError creates license error', () => {
    const error = createLicenseError(ErrorCodes.LICENSE_EXPIRED)
    expect(error.code).toBe(ErrorCodes.LICENSE_EXPIRED)
  })

  it('createApiError creates API_ERROR', () => {
    const error = createApiError('Request failed', 'status 500')
    expect(error.code).toBe(ErrorCodes.API_ERROR)
    expect(error.details).toBe('status 500')
  })

  it('createFileError creates file error', () => {
    const error = createFileError(ErrorCodes.PERMISSION_DENIED, '/etc/secret')
    expect(error.code).toBe(ErrorCodes.PERMISSION_DENIED)
    expect(error.details).toBe('/etc/secret')
  })

  it('createContextError creates context error', () => {
    const error = createContextError(ErrorCodes.CONTEXT_CORRUPTED)
    expect(error.code).toBe(ErrorCodes.CONTEXT_CORRUPTED)
  })
})

describe('handleError', () => {
  let consoleSpy

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('prints LKError message', () => {
    const error = new LKError(ErrorCodes.NOT_CONFIGURED)
    handleError(error)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('prints regular Error message', () => {
    const error = new Error('Regular error')
    handleError(error)
    expect(consoleSpy).toHaveBeenCalledWith('Regular error')
  })

  it('silent mode does not print', () => {
    const error = new LKError(ErrorCodes.API_ERROR)
    handleError(error, { silent: true })
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('adds context prefix', () => {
    const error = new Error('test error')
    handleError(error, { context: 'sync' })
    expect(consoleSpy).toHaveBeenCalledWith('sync: test error')
  })

  it('returns the error', () => {
    const error = new LKError(ErrorCodes.API_ERROR)
    const result = handleError(error, { silent: true })
    expect(result).toBe(error)
  })
})

describe('withErrorHandling', () => {
  let consoleSpy

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('returns result on success', async () => {
    const fn = async () => 'success'
    const wrapped = withErrorHandling(fn)
    const result = await wrapped()
    expect(result).toBe('success')
  })

  it('handles errors silently when configured', async () => {
    const fn = async () => { throw new Error('test') }
    const wrapped = withErrorHandling(fn, { silent: true })
    await wrapped()
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await withRetry(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new LKError(ErrorCodes.API_RATE_LIMITED))
      .mockResolvedValueOnce('success')

    const result = await withRetry(fn, { baseDelay: 10 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new LKError(ErrorCodes.API_RATE_LIMITED))

    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 }))
      .rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new LKError(ErrorCodes.NOT_CONFIGURED))

    await expect(withRetry(fn, { baseDelay: 10 }))
      .rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry regular errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('regular error'))

    await expect(withRetry(fn, { baseDelay: 10 }))
      .rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"key": "value"}')
    expect(result).toEqual({ key: 'value' })
  })

  it('returns fallback for invalid JSON', () => {
    const result = safeJsonParse('not json', 'fallback')
    expect(result).toBe('fallback')
  })

  it('returns null by default for invalid JSON', () => {
    const result = safeJsonParse('invalid')
    expect(result).toBe(null)
  })

  it('parses arrays', () => {
    const result = safeJsonParse('[1, 2, 3]')
    expect(result).toEqual([1, 2, 3])
  })

  it('parses primitives', () => {
    expect(safeJsonParse('123')).toBe(123)
    expect(safeJsonParse('true')).toBe(true)
    expect(safeJsonParse('"string"')).toBe('string')
  })
})

describe('isErrorCode', () => {
  it('returns true for matching LKError', () => {
    const error = new LKError(ErrorCodes.NOT_CONFIGURED)
    expect(isErrorCode(error, ErrorCodes.NOT_CONFIGURED)).toBe(true)
  })

  it('returns false for non-matching code', () => {
    const error = new LKError(ErrorCodes.NOT_CONFIGURED)
    expect(isErrorCode(error, ErrorCodes.API_ERROR)).toBe(false)
  })

  it('returns false for regular Error', () => {
    const error = new Error('test')
    expect(isErrorCode(error, ErrorCodes.NOT_CONFIGURED)).toBe(false)
  })

  it('returns false for non-error', () => {
    expect(isErrorCode('not an error', ErrorCodes.NOT_CONFIGURED)).toBe(false)
    expect(isErrorCode(null, ErrorCodes.NOT_CONFIGURED)).toBe(false)
  })
})
