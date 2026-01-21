import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApiKey, log } from './config.js';
import {
  buildAnalyzeFilePrompt, buildAnalyzeFilesPrompt, buildProjectPrompt, buildIgnorePrompt, buildClassifyPrompt, buildExpandPrompt, buildExpandPromptCompact, buildProjectSummaryPrompt, extractJsonFromText, generateDefaultResults, logLlmCall, logLlmResponse, recordError, DEFAULT_ANALYSIS
} from './ai-prompts.js';
const MODEL = 'gemini-2.5-flash';
let genAI=null, model=null, jsonModel=null, curKey=null;
function initClient(){
  const key = getApiKey();
  if (!key) throw new Error('Gemini API key not configured. Run: lk setup');
  if (model && curKey === key) return;
  log('GEMINI', 'Initializing client...');
  genAI = new GoogleGenerativeAI(key);
  model = genAI.getGenerativeModel({ model: MODEL });
  jsonModel = genAI.getGenerativeModel({model: MODEL, generationConfig: {responseMimeType: 'application/json'}});
  curKey = key;
  log('GEMINI', `Client ready (model: ${MODEL})`);
}
export async function validateApiKey(key){
  try {
    const tai = new GoogleGenerativeAI(key);
    const tm = tai.getGenerativeModel({ model: MODEL });
    await tm.generateContent('Hi');
    return { valid: true };
  } catch (e) {
    const msg = e.message || 'Unknown error';
    if (msg.includes('API_KEY_INVALID') || msg.includes('401') || msg.includes('403')) return { valid: false, error: 'Invalid API key' };
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) return { valid: true };
    return { valid: false, error: msg };
  }
}
export async function checkRateLimit(){
  if (!model) initClient();
  try {
    await model.generateContent('.');
    return { ok: true, rateLimited: false };
  } catch (e) {
    const msg = e.message || 'Unknown error';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) return { ok: true, rateLimited: true };
    if (msg.includes('API_KEY_INVALID') || msg.includes('401') || msg.includes('403')) return { ok: false, rateLimited: false, error: 'Invalid API key' };
    return { ok: false, rateLimited: false, error: msg };
  }
}
async function callJsonApi(p, operationType = null){
  const trk = logLlmCall('GEMINI', 'JSON API call', p.length, MODEL, operationType);
  try {
    const res = await jsonModel.generateContent(p);
    const txt = res.response?.text?.()?.trim() || null;
    logLlmResponse(trk, txt);
    return txt;
  } catch (e) {
    recordError({provider: 'GEMINI', operation: 'JSON API call', operationType, error: e.message});
    throw e;
  }
}
async function callTextApi(p, operationType = null){
  const trk = logLlmCall('GEMINI', 'Text API call', p.length, MODEL, operationType);
  try {
    const res = await model.generateContent(p);
    const txt = res.response?.text?.()?.trim() || null;
    logLlmResponse(trk, txt);
    return txt;
  } catch (e) {
    recordError({provider: 'GEMINI', operation: 'Text API call', operationType, error: e.message});
    throw e;
  }
}
function buildGeminiAnalyzePrompt({ lkContent, file, content, action }){
  return `You are a JSON-only response bot. Analyze this file for a .lk context file.
File: ${file}
Action: ${action}
${content ? `Content:\n${content.slice(0, 3000)}` : ''}
Current .lk context:
${lkContent}
Symbols (pick ONE):
- "▸": Entry point, main/index
- "⇄": Interface, API, commands, entry points
- "λ": Core logic, utilities, helpers
- "⚙": Config files
- "⧫": Test files
- "⊚": UI Component
- "⟐": Schema, types, models
- "◈": Background jobs, workers, queues
- "⤳": Pipeline, workflow, process
- "⚑": State management (store, reducer)
Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"
IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.
Respond with this JSON schema:
{
  "symbol": "string (one of: ▸, ⇄, λ, ⚙, ⧫, ⊚, ⟐, ◈, ⤳, ⚑)",
  "description": "string (3-6 keywords) or null",
  "domain": "string"
}
Or: {"ignore": true}`;
}
function buildGeminiBatchPrompt({ lkContent, files }){
  const fs = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n');
  return `You are a JSON-only response bot. Analyze these ${files.length} files for a .lk context file.
FILES TO ANALYZE:
${fs}
Current .lk context:
${lkContent}
Symbols (pick ONE per file):
- "▸": Entry point, main/index
- "⇄": Interface, API, commands, entry points
- "λ": Core logic, utilities, helpers
- "⚙": Config files
- "⧫": Test files
- "⊚": UI Component
- "⟐": Schema, types, models
- "◈": Background jobs, workers, queues
- "⤳": Pipeline, workflow, process
- "⚑": State management (store, reducer)
Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"
IMPORTANT: If a file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return "ignore": true instead of symbol/domain.
Respond with a JSON array. Each element MUST have "file" matching the input filename:
[
  { "file": "path/to/file1.js", "symbol": "λ", "description": "keywords", "domain": "core" },
  { "file": "path/to/file2.js", "ignore": true },
  { "file": "path/to/file3.js", "symbol": "⇄", "description": "keywords", "domain": "cli" }
]`;
}
export async function analyzeFile({ lkContent, file, content, action }){
  if (!model) initClient();
  log('GEMINI', `analyzeFile: ${action} ${file}`);
  log('GEMINI', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`);
  const p = buildGeminiAnalyzePrompt({ lkContent, file, content, action });
  const txt = await callJsonApi(p, 'analyzeFile');
  if (!txt) { log('GEMINI', 'Empty response - using defaults'); return DEFAULT_ANALYSIS; }
  log('GEMINI', `Response: ${txt}`);
  const prs = extractJsonFromText(txt, false);
  if (prs) { log('GEMINI', 'Parsed result:', JSON.stringify(prs)); return prs; }
  log('GEMINI', 'Parse failed - using defaults');
  return DEFAULT_ANALYSIS;
}
export async function analyzeFiles({ lkContent, files }){
  if (!model) initClient();
  if (!files.length) return [];
  if (files.length === 1) { const res = await analyzeFile({ lkContent, ...files[0] }); return [{ file: files[0].file, ...res }]; }
  log('GEMINI', `analyzeFiles: ${files.length} files`);
  log('GEMINI', `Context: ${lkContent.length} chars`);
  const p = buildGeminiBatchPrompt({ lkContent, files });
  const txt = await callJsonApi(p, 'analyzeFiles');
  if (!txt) { log('GEMINI', 'Empty batch response - returning defaults'); return generateDefaultResults(files); }
  const prs = extractJsonFromText(txt, true);
  if (prs) { log('GEMINI', `Parsed ${prs.length} results`); return prs; }
  log('GEMINI', 'Batch failed, returning defaults');
  return generateDefaultResults(files);
}
export async function generateProject({ files, packageJson, context }){
  if (!model) initClient();
  log('GEMINI', `generateProject: ${files.length} files, context: ${context?.length || 0} chars`);
  const p = buildProjectPrompt({ files, packageJson, context });
  const txt = await callTextApi(p, 'generateProject');
  if (!txt) throw new Error('Empty response from API');
  const cln = txt.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const prs = JSON.parse(cln);
    if (prs.lk && prs.human) return { lk: prs.lk.trim(), human: prs.human.trim() };
  } catch (e) { log('GEMINI', `Failed to parse project JSON: ${e.message}`); }
  return { lk: cln, human: null };
}
export async function generateIgnore({ files, globalPatterns = [] }){
  if (!model) initClient();
  log('GEMINI', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`);
  const p = buildIgnorePrompt({ files, globalPatterns });
  const txt = await callTextApi(p, 'generateIgnore');
  if (!txt) { log('GEMINI', 'Empty response - no project-specific patterns'); return []; }
  const lns = txt.split('\n').filter(l => l.trim());
  log('GEMINI', `Generated ${lns.length} ignore lines`);
  return lns;
}
export async function classifyPrompt(userPrompt, projectLk, availableDomains = [], previousContext = null){
  if (!model) initClient();
  log('GEMINI', `classifyPrompt: ${userPrompt.slice(0, 100)}...`);
  if (previousContext) log('GEMINI', `Previous context: ${previousContext.slice(0, 100)}...`);
  const p = buildClassifyPrompt(userPrompt, projectLk, availableDomains, previousContext);
  const txt = await callJsonApi(p, 'classifyPrompt');
  if (!txt) { log('GEMINI', 'Empty response - defaulting to passthrough'); return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }; }
  const prs = extractJsonFromText(txt, false);
  if (prs) { log('GEMINI', `Classification: ${JSON.stringify(prs)}`); return prs; }
  log('GEMINI', 'Parse failed - defaulting to passthrough');
  return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null };
}
export async function expandPrompt(userPrompt, projectLk, domainLk){
  if (!model) initClient();
  log('GEMINI', `expandPrompt: ${userPrompt.slice(0, 100)}...`);
  const p = buildExpandPrompt(userPrompt, projectLk, domainLk);
  const txt = await callJsonApi(p, 'expandPrompt');
  if (!txt) { log('GEMINI', 'Empty response - returning empty result'); return { direct_answer: null, files: [] }; }
  const prs = extractJsonFromText(txt, false);
  if (prs) { log('GEMINI', `Expansion: ${JSON.stringify(prs)}`); return prs; }
  log('GEMINI', 'Parse failed - returning empty result');
  return { direct_answer: null, files: [] };
}
export async function expandPromptCompact(userPrompt, projectSummary, domainIndex, previousContext = null){
  if (!model) initClient();
  log('GEMINI', `expandPromptCompact: ${userPrompt.slice(0, 100)}...`);
  if (previousContext) log('GEMINI', `Including previous context: ${previousContext.length} chars`);
  const p = buildExpandPromptCompact(userPrompt, projectSummary, domainIndex, previousContext);
  const txt = await callJsonApi(p, 'expandPromptCompact');
  if (!txt) { log('GEMINI', 'Empty response - returning empty result'); return { direct_answer: null, navigation_guide: null, files: [] }; }
  const prs = extractJsonFromText(txt, false);
  if (prs) { log('GEMINI', `Expansion: ${JSON_stringify(prs)}`); return prs; }
  log('GEMINI', 'Parse failed - returning empty result');
  return { direct_answer: null, navigation_guide: null, files: [] };
}
export async function generateProjectSummary(projectLk, domainNames = []){
  if (!model) initClient();
  log('GEMINI', `generateProjectSummary: ${projectLk.length} chars, ${domainNames.length} domains`);
  const p = buildProjectSummaryPrompt(projectLk, domainNames);
  const txt = await callTextApi(p, 'generateProjectSummary');
  if (!txt) { log('GEMINI', 'Empty response - no summary generated'); return null; }
  return txt.trim();
}