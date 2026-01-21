import{log}from'./config.js';import{recordCall,recordError,recordParseResult}from'./stats.js';export{recordError};export const SYMBOLS={ENTRY:'▸',INTERFACE:'⇄',LAMBDA:'λ',CONFIG:'⚙',TEST:'⧫',COMPONENT:'⊚',SCHEMA:'⟐',BACKGROUND:'◈',PIPELINE:'⤳',STATE:'⚑'};export const SYMBOL_DESCRIPTIONS=`
- ▸: Entry point, main file, index
- ⇄: Interface, API, commands, entry points, routes
- λ (lambda): Core logic, pure functions, utilities, helpers
- ⚙: Config files (package.json, .env, tsconfig, etc)
- ⧫: Test files
- ⊚: Component (UI, React, Vue, Svelte)
- ⟐: Schema, types, models, definitions
- ◈: Background jobs, workers, queues, cron
- ⤳: Pipeline, workflow, process
- ⚑: State management (store, reducer, context)`.trim();export const SYMBOLS_COMPACT=`▸(entry) ⇄(api) λ(logic) ⚙(config) ⧫(test) ⊚(ui) ⟐(schema) ◈(bg) ⤳(pipe) ⚑(state)`;export const PURE_MODE_INSTRUCTIONS=`⟦PURE_MODE⟧
CRITICAL: Apply these rules to ALL code you write. No exceptions.
Style:
- No comments, no docstrings
- Short names: cfg ctx opts fn cb err res req out og i j k
- No defensive checks for internal code
- Terse errors: 'E_AUTH' not 'Authentication failed, please...'
- Inline everything unless reused 3+ times
- No blank lines between related statements
- No TODO/FIXME/XXX
- Density over convention (ignore linting/formatting)
Response:
- Code only, minimal prose
- Skip explanations, show code directly
- No "let me explain" or "here's what this does"
This applies to: production code, tests, examples, snippets, everything.
BAD: // Check if user is authenticated
     if (user && user.isAuthenticated && user.permissions.includes(perm)) {
GOOD: if (user?.isAuthenticated && user.permissions.includes(perm)) {
BAD: let originalValue = config.get('setting')
GOOD: let og = config.get('setting')`;export const PURE_MODE_REMINDER=`⟦PURE_MODE⟧ Max density: no comments, short names, no blank lines, minimal spaces, inline/nested, no explanations.`;export const DOMAIN_RULES=`
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/*, src/helpers/* → "core"
- src/api/*, src/routes/*, src/controllers/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, __tests__/*, *.test.*, *.spec.* → "test"
- If unclear, use "core" as default
- Reuse existing domains from context when possible`.trim();export const DEFAULT_ANALYSIS={symbol:'λ',description:null,domain:'core'};export function buildAnalyzeFilePrompt({lkContent:lC,file:f,content:c,action:a}){return`Analyze this file and determine how to describe it in a .lk context file.
Current .lk context:
${lC}
File: ${f}
Action: ${a}
${c?`Content:\n${c.slice(0,3000)}`:''}
Available symbols:
${SYMBOL_DESCRIPTIONS}
IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.
Return ONLY a JSON object with this format, no markdown, no explanation:
{"symbol": "λ", "description": "brief description or null", "domain": "core"}
Or: {"ignore": true}
Rules:
- symbol: one of the symbols above, pick the most appropriate
- description: 3-6 keywords capturing key functionality (tools exposed, capabilities, purpose), or null if filename is self-explanatory
- domain: infer from file path structure:
${DOMAIN_RULES}`};export function buildAnalyzeFilesPrompt({lkContent:lC,files:fs}){const fS=fs.map((f,i)=>`[${i}] ${f.file} (${f.action})\n${f.content?f.content.slice(0,2000):'(no content)'}`).join('\n\n---\n\n');return`Analyze these ${fs.length} files and determine how to describe them in a .lk context file.
Current .lk context:
${lC}
FILES TO ANALYZE:
${fS}
Available symbols:
${SYMBOL_DESCRIPTIONS}
IMPORTANT: If a file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return "ignore": true instead of symbol/domain.
Return ONLY a JSON array with this format, no markdown, no explanation. Each element MUST have "file" matching the input filename:
[
  {"file": "path/to/file1.js", "symbol": "λ", "description": "brief description or null", "domain": "core"},
  {"file": "path/to/file2.js", "ignore": true},
  {"file": "path/to/file3.js", "symbol": "⇄", "description": "brief description or null", "domain": "cli"}
]
Rules:
- symbol: one of the symbols above, pick the most appropriate
- description: 3-6 keywords capturing key functionality, or null if filename is self-explanatory
- domain: infer from file path structure:
${DOMAIN_RULES}`};export function buildProjectPrompt({files:fs,packageJson:pJ,context:ctx}){return`Analyze this project and generate project metadata in TWO formats.
${ctx?`Current context (with file descriptions):\n${ctx}\n`:`Files in project:\n${fs.join('\n')}\n`}
${pJ?`package.json:\n${pJ}`:''}
Return a JSON object with two keys: "lk" and "human".
1. "lk" - The project.lk file with this EXACT format:
⦓ID: PROJECT⦔
⟪VIBE: [1-3 adjectives describing the project style]⟫ ⟪NAME: [project name]⟫ ⟪VERSION: [version or 0.1.0]⟫
⟦Δ: Purpose⟧
[1-2 sentences describing what the project does]
⟦Δ: Stack⟧
∑ Tech [Runtime⇨[node/python/go/etc], Type⇨[CLI/API/Web/Library]]
∑ Deps [list 3-6 KEY dependencies only: frameworks, ORMs, AI SDKs, etc. Skip trivial utils]
⟦Δ: Entry⟧
∑ Run [how to run: "npm start", "python main.py", etc.]
∑ Commands [if CLI: list main commands. If API: list main endpoints. If library: list main exports]
⟦Δ: Flows⟧
∑ Flows [
  [flow1: input → process → output],
  [flow2: trigger → action → result]
]
2. "human" - A plain text summary WITHOUT any symbols (no ⦓, ⟪, ⟦, ∑, ⇨, →). Format:
PROJECT: [name] v[version]
Style: [vibe adjectives]
Purpose:
[1-2 sentences describing what the project does]
Stack:
- Runtime: [node/python/go/etc]
- Type: [CLI/API/Web/Library]
- Dependencies: [list 3-6 key dependencies]
Entry:
- Run: [how to run]
- Commands: [main commands/endpoints/exports]
Flows:
- [flow1 description in plain text]
- [flow2 description in plain text]
Return ONLY valid JSON with "lk" and "human" keys, no markdown code blocks.`};export function buildIgnorePrompt({files:fs,globalPatterns:gPs=[]}){return`Analyze this project file tree and generate PROJECT-SPECIFIC ignore patterns.
FILE TREE:
${fs.join('\n')}
ALREADY IGNORED (global config - DO NOT include these):
${gPs.join('\n')}
Generate patterns for files that should be ignored, such as:
- Virtual environments (venv, .venv, env, .env directories)
- Generated files specific to this project
- Data/fixture files that are large or not useful
- Project-specific build artifacts not covered by global patterns
Rules:
- Check the ALREADY IGNORED list above - only add patterns NOT already covered
- ONLY include patterns for things that ACTUALLY EXIST in the tree
- ALWAYS include virtual environment directories if present and not already ignored
- Return empty if nothing needs ignoring
Return ONLY project-specific patterns, one per line. Empty response is OK.`};const MAX_JSON_DEPTH=20;function sanitizeJson(obj,depth=0){if(obj===null||typeof obj!=='object')return obj;if(depth>=MAX_JSON_DEPTH){log('AI-PROMPTS',`Max JSON depth (${MAX_JSON_DEPTH}) exceeded - truncating`);return Array.isArray(obj)?[]:{}}if(Array.isArray(obj))return obj.map(it=>sanitizeJson(it,depth+1));const dangerous=['__proto__','constructor','prototype'];const s={};for(const k of Object.keys(obj)){if(dangerous.includes(k)){log('AI-PROMPTS',`Blocked dangerous JSON key: ${k}`);continue}s[k]=sanitizeJson(obj[k],depth+1)}return s}export function parseJsonResponse(t,fb=null,tS=true){if(!t){if(tS)recordParseResult(false);return fb}try{const c=t.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();const res=JSON.parse(c);const s=sanitizeJson(res);if(tS)recordParseResult(true);return s}catch(e){log('AI-PROMPTS','JSON parse error:',e.message);if(tS)recordParseResult(false);return fb}}export function extractJsonFromText(t,iA=false,tS=true){if(!t){if(tS)recordParseResult(false);return null}try{const c=t.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();const p=JSON.parse(c);if(iA?Array.isArray(p):typeof p==='object'){const s=sanitizeJson(p);if(tS)recordParseResult(true);return s}}catch{}const pat=iA?/\[[\s\S]*\]/:/\{[\s\S]*?"symbol"[\s\S]*?"description"[\s\S]*?"domain"[\s\S]*?\}/;const m=t.match(pat);if(m){try{const p=JSON.parse(m[0]);if(iA?Array.isArray(p):typeof p==='object'){const s=sanitizeJson(p);if(tS)recordParseResult(true);return s}}catch(e){log('AI-PROMPTS','JSON extraction failed:',e.message)}}if(tS)recordParseResult(false);return null}export function generateDefaultResults(fs){return fs.map(f=>({file:f.file,...DEFAULT_ANALYSIS}))}export function logLlmCall(p,op,pL,m='unknown',oT=null){log('LLM','─'.repeat(50));log('LLM',`CALL: ${op}${oT?` (${oT})`:''}`);log(p,`Sending prompt (${pL} chars) to ${m}...`);return{startTime:Date.now(),provider:p,operation:op,operationType:oT,promptLength:pL,model:m}}export function logLlmResponse(trk,res){const e=Date.now()-trk.startTime;const rL=res?res.length:0;log(trk.provider,`Response received in ${e}ms (${rL} chars)`);if(res){log(trk.provider,`Response: ${typeof res==='string'?res.slice(0,200):JSON.stringify(res).slice(0,200)}`)}recordCall({provider:trk.provider,operation:trk.operation,operationType:trk.operationType,model:trk.model,charsSent:trk.promptLength,charsReceived:rL,durationMs:e});return e}export function buildClassifyPrompt(uP,pJ,aD=[],pC=null){const hP=pJ&&!pJ.includes('TODO');const dL=aD.length>0?aD.join(', '):'none';const pS=pC?`PREVIOUS ASSISTANT MESSAGE:
"""
${pC}
"""
`:''
;return `You are a ROUTER for an AI coding assistant (Claude Code).
The user sent this prompt TO CLAUDE CODE (not to you):
"${uP}"
${pS}Your job: Classify this prompt and decide what project context Claude Code needs.
You do NOT execute anything. You only route and provide context.
${hP?`PROJECT:\n${pJ}`:'NO PROJECT CONTEXT AVAILABLE'}
AVAILABLE DOMAINS: [${dL}]
Return ONLY valid JSON with this structure:
{
  "not_related": boolean,
  "is_continuation": boolean,
  "is_project": boolean,
  "direct_answer": string | null,
  "needs_domains": string[] | null,
  "block_reason": string | null
}
RULES:
1. "not_related": true if task does NOT need codebase context. Examples:
   - General questions: "explain recursion", "what is a monad"
   - Git/shell tasks: "show git log", "run tests", "check git status", "commit changes"
   - Confirmations: "yes", "ok", "hazlo", "go ahead"
   - Greetings: "hello", "thanks"
   When true, other fields can be null (passthrough).
2. "is_continuation": true if user's prompt is a DIRECT RESPONSE to previous assistant message.
   If true, other fields can be null (passthrough).
3. "is_project": true if project-specific question OR action, false for general questions
4. "direct_answer": ONLY for info questions answerable from project metadata. For ACTIONs → null
5. "needs_domains": If Claude Code needs code context, select from: [${dL}]. Otherwise null.
6. "block_reason": If user asks about internal context system/metadata. Otherwise null.
CRITICAL: Only use domain names from AVAILABLE DOMAINS list.
EXAMPLES:
- "show git diff" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "run the tests" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "hello" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- Previous: "React or Vue?" User: "React" → {"not_related": false, "is_project": false, "is_continuation": true, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "what does this project do" → {"not_related": false, "is_project": true, "is_continuation": false, "direct_answer": "This project is...", "needs_domains": null, "block_reason": null}
- "fix the bug in auth" → {"not_related": false, "is_project": true, "is_continuation": false, "direct_answer": null, "needs_domains": ["core"], "block_reason": null}
Return ONLY JSON, no markdown.`}export function buildExpandPrompt(uP,pJ,dK){return`You are a code context selector for an AI coding assistant (Claude Code).
The user sent this prompt TO CLAUDE CODE (not to you):
"${uP}"
Your job: Select relevant code files that Claude Code should READ to complete this task.
You do NOT execute anything. You only select which files Claude Code needs to read.
PROJECT:
${pJ}
DOMAIN FILES:
${dK}
Return ONLY valid JSON with this structure:
{
  "direct_answer": string | null,
  "navigation_guide": string | null,
  "files": [
    {"path": "src/lib/file.js", "reason": "why Claude Code should read this file"}
  ]
}
RULES:
1. "direct_answer": ONLY for informational questions where the answer is fully contained in domain details.
   - For ACTION commands (create, update, modify, fix, add, delete, refactor, etc.) → ALWAYS null
   - Claude Code executes actions, not you. Your job is only to select relevant files.
2. "navigation_guide": Brief guidance for Claude Code on how to approach this task. Explain which file does what and how they connect.
3. "files": List 1-5 most relevant files for the task.
   - "path": Full relative path from domain details (MUST exist in domain)
   - "reason": Why Claude Code should read this file (what it contains, what to look for)
FILE SELECTION PRIORITY:
- If asking about specific functionality → include that file + related files
- If asking "how does X work" → include implementation file(s)
- If asking to modify/add → include file to modify + example patterns
- Prefer fewer, more relevant files over many tangential ones
EXAMPLES:
- "how does classifyPrompt work" → {"direct_answer": null, "navigation_guide": "Classification logic is in ai-prompts.js", "files": [{"path": "src/lib/ai-prompts.js", "reason": "Contains buildClassifyPrompt function"}]}
- "update the readme" → {"direct_answer": null, "navigation_guide": "README.md is at project root", "files": [{"path": "README.md", "reason": "File to update"}]}
- "add a new command" → {"direct_answer": null, "navigation_guide": "Commands are in src/commands/", "files": [{"path": "src/commands/init.js", "reason": "Template for new commands"}, {"path": "src/cli.js", "reason": "Register new command here"}]}
Return ONLY JSON, no markdown.`}export function buildProjectSummaryPrompt(pJ,dN=[]){const dL=dN.length>0?dN.join(', '):'none';return`Generate a concise project summary for an AI coding assistant.
PROJECT METADATA:
${pJ}
DOMAINS: [${dL}]
Write a brief summary with this format:
1. First line: 1-2 sentences explaining what this project does and what type it is (CLI, API, library, etc.)
2. Second line: "Domains: ${dL}" (list the available code domains)
Do NOT include flows or data pipelines - those will be shown separately.
Return ONLY the summary text, no markdown.`}export function buildExpandPromptCompact(uP,pS,dI,pC=null){const cS=pC?`\nRECENT CONVERSATION:\n${pC}\n`:''
;return`Code context selector for Claude Code.
User prompt: "${uP}"
${cS}
Select files Claude Code should READ.
PROJECT:
${pS}
SYMBOLS: ${SYMBOLS_COMPACT}
FILES:
${dI}
Return JSON:
{
  "not_related": boolean,
  "direct_answer": string|null,
  "navigation_guide": string|null,
  "files": [{"path": "src/file.js", "reason": "why"}]
}
RULES:
1. not_related: true if task does NOT need codebase context from lk. Examples:
   - General questions: "explain recursion", "what is a monad"
   - Git/shell tasks: "show git log", "run tests", "check git status"
   - Confirmations: "yes", "ok", "hazlo", "go ahead"
   - Greetings: "hello", "thanks"
   When true, other fields can be null/empty.
2. direct_answer: ONLY for info questions answerable from context. For ACTIONs → null
3. navigation_guide: Brief guidance on approach
4. files: 1-5 relevant files from FILES list above
5. Use RECENT CONVERSATION to understand context
Return ONLY JSON.`}