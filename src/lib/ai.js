import { getAiProvider, log } from './config.js'
import * as anthropic from './anthropic.js'
import * as gemini from './gemini.js'

function getProvider() {
  const provider = getAiProvider()
  if (!provider) throw new Error('AI provider not configured. Run: lk setup')

  log('AI', `Using provider: ${provider}`)
  return provider === 'anthropic' ? anthropic : gemini
}

export async function analyzeFile(params) {
  return getProvider().analyzeFile(params)
}

export async function analyzeFiles(params) {
  return getProvider().analyzeFiles(params)
}

export async function generateProject(params) {
  return getProvider().generateProject(params)
}

export async function describeLk(params) {
  return getProvider().describeLk(params)
}

export async function generateIgnore(params) {
  return getProvider().generateIgnore(params)
}

export async function validateApiKey(provider, apiKey) {
  log('AI', `Validating ${provider} API key...`)
  const providerModule = provider === 'anthropic' ? anthropic : gemini
  return providerModule.validateApiKey(apiKey)
}

/**
 * Check if the configured API is rate limited by making a minimal call
 * @returns {Promise<{ok: boolean, rateLimited: boolean, error?: string}>}
 */
export async function checkRateLimit() {
  const provider = getAiProvider()
  if (!provider) return { ok: false, error: 'No provider configured' }

  log('AI', `Checking rate limit for ${provider}...`)

  try {
    const providerModule = provider === 'anthropic' ? anthropic : gemini
    const result = await providerModule.checkRateLimit()
    return result
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function classifyPrompt(userPrompt, projectLk, availableDomains = [], previousContext = null) {
  return getProvider().classifyPrompt(userPrompt, projectLk, availableDomains, previousContext)
}

export async function expandPrompt(userPrompt, projectLk, domainLk) {
  return getProvider().expandPrompt(userPrompt, projectLk, domainLk)
}
