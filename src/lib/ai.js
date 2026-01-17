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

export async function classifyPrompt(userPrompt, projectLk, availableDomains = []) {
  return getProvider().classifyPrompt(userPrompt, projectLk, availableDomains)
}

export async function expandPrompt(userPrompt, projectLk, domainLk) {
  return getProvider().expandPrompt(userPrompt, projectLk, domainLk)
}
