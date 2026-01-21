import Anthropic from '@anthropic-ai/sdk';import {getApiKey,log} from './config.js';import {buildAnalyzeFilePrompt,buildAnalyzeFilesPrompt,buildProjectPrompt,buildIgnorePrompt,buildClassifyPrompt,buildExpandPrompt,buildExpandPromptCompact,buildProjectSummaryPrompt,parseJsonResponse,generateDefaultResults,logLlmCall,logLlmResponse,recordError,DEFAULT_ANALYSIS} from './ai-prompts.js';
const MODEL='claude-3-5-haiku-20241022';let client=null;
function initClient(){
  log('ANTHROPIC','Initializing client...');
  const k=getApiKey('anthropic');
  if(!k)throw new Error('Anthropic API key not configured. Run: lk setup');
  client=new Anthropic({apiKey:k});
  log('ANTHROPIC',`Client ready (model: ${MODEL})`);
}
export async function validateApiKey(k){
  try{
    const c=new Anthropic({apiKey:k});
    await c.messages.create({model:MODEL,max_tokens:1,messages:[{role:'user',content:'Hi'}]});
    return {valid:true};
  }catch(e){
    const msg=e.message||'Unknown error';
    if(msg.includes('401')||msg.includes('invalid_api_key')||msg.includes('authentication'))return {valid:false,error:'Invalid API key'};
    if(msg.includes('429')||msg.includes('rate'))return {valid:true};
    return {valid:false,error:msg};
  }
}
export async function checkRateLimit(){
  if(!client)initClient();
  try{
    await client.messages.create({model:MODEL,max_tokens:1,messages:[{role:'user',content:'.'}]});
    return {ok:true,rateLimited:false};
  }catch(e){
    const msg=e.message||'Unknown error';
    if(msg.includes('429')||msg.includes('rate'))return {ok:true,rateLimited:true};
    if(msg.includes('401')||msg.includes('invalid_api_key')||msg.includes('authentication'))return {ok:false,rateLimited:false,error:'Invalid API key'};
    return {ok:false,rateLimited:false,error:msg};
  }
}
async function callApi(p,maxT=256,op=null){
  const t=logLlmCall('ANTHROPIC','API call',p.length,MODEL,op);
  try{
    const res=await client.messages.create({model:MODEL,max_tokens:maxT,messages:[{role:'user',content:p}]});
    const txt=res.content?.[0]?.text?.trim()||null;
    logLlmResponse(t,txt);
    return txt;
  }catch(e){
    recordError({provider:'ANTHROPIC',operation:'API call',operationType:op,error:e.message});
    throw e;
  }
}
export async function analyzeFile({lkContent:lk,file,content,action}){
  if(!client)initClient();
  log('ANTHROPIC',`analyzeFile: ${action} ${file}`);
  log('ANTHROPIC',`Context: ${lk.length} chars, Content: ${content?.length||0} chars`);
  const p=buildAnalyzeFilePrompt({lkContent:lk,file,content,action});
  const txt=await callApi(p,256,'analyzeFile');
  if(!txt){
    log('ANTHROPIC','Empty response - using defaults');
    return DEFAULT_ANALYSIS;
  }
  log('ANTHROPIC',`Response: ${txt}`);
  const r=parseJsonResponse(txt,DEFAULT_ANALYSIS);
  log('ANTHROPIC','Parsed result:',JSON.stringify(r));
  return r;
}
export async function analyzeFiles({lkContent:lk,files}){
  if(!client)initClient();
  if(files.length===0)return [];
  if(files.length===1){
    const res=await analyzeFile({lkContent:lk,...files[0]});
    return [{file:files[0].file,...res}];
  }
  log('ANTHROPIC',`analyzeFiles: ${files.length} files`);
  log('ANTHROPIC',`Context: ${lk.length} chars`);
  const p=buildAnalyzeFilesPrompt({lkContent:lk,files});
  const txt=await callApi(p,2048,'analyzeFiles');
  if(!txt){
    log('ANTHROPIC','Empty batch response - returning defaults');
    return generateDefaultResults(files);
  }
  const r=parseJsonResponse(txt);
  if(Array.isArray(r)){
    log('ANTHROPIC',`Parsed ${r.length} results`);
    return r;
  }
  log('ANTHROPIC','Batch failed, returning defaults');
  return generateDefaultResults(files);
}
export async function generateProject({files,packageJson:pj,context:ctx}){
  if(!client)initClient();
  log('ANTHROPIC',`generateProject: ${files.length} files, context: ${ctx?.length||0} chars`);
  const p=buildProjectPrompt({files,packageJson:pj,context:ctx});
  const txt=await callApi(p,2048,'generateProject');
  if(!txt)throw new Error('Empty response from API');
  const cln=txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  try{
    const prs=JSON.parse(cln);
    if(prs.lk&&prs.human)return {lk:prs.lk.trim(),human:prs.human.trim()};
  }catch(e){
    log('ANTHROPIC',`Failed to parse project JSON: ${e.message}`);
  }
  return {lk:cln,human:null};
}
export async function generateIgnore({files,globalPatterns:gps=[]}){
  if(!client)initClient();
  log('ANTHROPIC',`generateIgnore: ${files.length} files, ${gps.length} global patterns`);
  const p=buildIgnorePrompt({files,globalPatterns:gps});
  const txt=await callApi(p,1024,'generateIgnore');
  if(!txt){
    log('ANTHROPIC','Empty response - no project-specific patterns');
    return [];
  }
  const lns=txt.split('\n').filter(l=>l.trim());
  log('ANTHROPIC',`Generated ${lns.length} ignore lines`);
  return lns;
}
export async function classifyPrompt(up,plk,ads=[],pc=null){
  if(!client)initClient();
  log('ANTHROPIC',`classifyPrompt: ${up.slice(0,100)}...`);
  if(pc)log('ANTHROPIC',`Previous context: ${pc.slice(0,100)}...`);
  const p=buildClassifyPrompt(up,plk,ads,pc);
  const txt=await callApi(p,512,'classifyPrompt');
  if(!txt){
    log('ANTHROPIC','Empty response - defaulting to passthrough');
    return {is_project:false,is_continuation:false,direct_answer:null,needs_domains:null,block_reason:null};
  }
  const r=parseJsonResponse(txt);
  if(r){
    log('ANTHROPIC',`Classification: ${JSON.stringify(r)}`);
    return r;
  }
  log('ANTHROPIC','Parse failed - defaulting to passthrough');
  return {is_project:false,is_continuation:false,direct_answer:null,needs_domains:null,block_reason:null};
}
export async function expandPrompt(up,plk,dlk){
  if(!client)initClient();
  log('ANTHROPIC',`expandPrompt: ${up.slice(0,100)}...`);
  const p=buildExpandPrompt(up,plk,dlk);
  const txt=await callApi(p,1024,'expandPrompt');
  if(!txt){
    log('ANTHROPIC','Empty response - returning empty result');
    return {direct_answer:null,files:[]};
  }
  const r=parseJsonResponse(txt);
  if(r){
    log('ANTHROPIC',`Expansion: ${JSON.stringify(r)}`);
    return r;
  }
  log('ANTHROPIC','Parse failed - returning empty result');
  return {direct_answer:null,files:[]};
}
export async function expandPromptCompact(up,ps,di,pc=null){
  if(!client)initClient();
  log('ANTHROPIC',`expandPromptCompact: ${up.slice(0,100)}...`);
  if(pc)log('ANTHROPIC',`Including previous context: ${pc.length} chars`);
  const p=buildExpandPromptCompact(up,ps,di,pc);
  const txt=await callApi(p,512,'expandPromptCompact');
  if(!txt){
    log('ANTHROPIC','Empty response - returning empty result');
    return {direct_answer:null,navigation_guide:null,files:[]};
  }
  const r=parseJsonResponse(txt);
  if(r){
    log('ANTHROPIC',`Expansion: ${JSON.stringify(r)}`);
    return r;
  }
  log('ANTHROPIC','Parse failed - returning empty result');
  return {direct_answer:null,navigation_guide:null,files:[]};
}
export async function generateProjectSummary(plk,dns=[]){
  if(!client)initClient();
  log('ANTHROPIC',`generateProjectSummary: ${plk.length} chars, ${dns.length} domains`);
  const p=buildProjectSummaryPrompt(plk,dns);
  const txt=await callApi(p,256,'generateProjectSummary');
  if(!txt){
    log('ANTHROPIC','Empty response - no summary generated');
    return null;
  }
  return txt.trim();
}