import fs from 'fs'
import path from 'path'
import {getAllFiles,getFileExtension,markCompacted} from './context.js'
import {getApiKey} from './config.js'
import {GoogleGenerativeAI} from '@google/generative-ai'
import {PURE_MODE_INSTRUCTIONS,logLlmCall,logLlmResponse,recordError} from './ai-prompts.js'
const MODEL='gemini-2.5-flash'
let model=null
function initModel(){
  const k=getApiKey('gemini')
  if(!k)throw new Error('Gemini API key required for compact')
  model=new GoogleGenerativeAI(k).getGenerativeModel({model:MODEL})
}
const JS_EXTS=['js','mjs','cjs','ts','tsx','jsx']
const PY_EXTS=['py']
const GO_EXTS=['go']
const RS_EXTS=['rs']
const CSS_EXTS=['css','scss','less','sass']
const JSON_EXTS=['json']
const HTML_EXTS=['html','htm','xml','svg']
const YAML_EXTS=['yaml','yml']
const SH_EXTS=['sh','bash','zsh']
const RUBY_EXTS=['rb']
const PHP_EXTS=['php']
const JAVA_EXTS=['java','kt','kts','scala']
const C_EXTS=['c','cpp','h','hpp','cc','cxx']
const SWIFT_EXTS=['swift']
const SQL_EXTS=['sql']
export function programmaticCompact(code,ext){
  if(JS_EXTS.includes(ext))return compactJS(code)
  if(PY_EXTS.includes(ext))return compactPY(code)
  if(GO_EXTS.includes(ext))return compactGO(code)
  if(RS_EXTS.includes(ext))return compactRS(code)
  if(CSS_EXTS.includes(ext))return compactCSS(code)
  if(JSON_EXTS.includes(ext))return compactJSON(code)
  if(HTML_EXTS.includes(ext))return compactHTML(code)
  if(YAML_EXTS.includes(ext))return compactYAML(code)
  if(SH_EXTS.includes(ext))return compactSH(code)
  if(RUBY_EXTS.includes(ext))return compactRuby(code)
  if(PHP_EXTS.includes(ext))return compactPHP(code)
  if(JAVA_EXTS.includes(ext))return compactJava(code)
  if(C_EXTS.includes(ext))return compactC(code)
  if(SWIFT_EXTS.includes(ext))return compactSwift(code)
  if(SQL_EXTS.includes(ext))return compactSQL(code)
  return{code,needsAI:true}
}
function compactJS(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/(^|[^:\\])\/\/.*$/gm,'$1')
  c=c.replace(/^\s*['"]use strict['"];?\s*$/gm,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('\n')
  c=c.replace(/ *([=+\-*/%<>&|!?:,;{}()\[\]]) */g,'$1')
  c=c.replace(/\{ +/g,'{').replace(/ +\}/g,'}')
  c=c.replace(/\( +/g,'(').replace(/ +\)/g,')')
  c=c.replace(/\[ +/g,'[').replace(/ +\]/g,']')
  c=c.replace(/\b(const|let|var|function|return|if|else|for|while|export|from|async|await|class|extends|new|throw|try|catch|finally|typeof|instanceof|of|in)\b(?=[^\s\w])/g,'$1 ')
  c=c.replace(/\bimport\b(?!\.meta)(?=[^\s\w])/g,'import ')
  c=c.replace(/([^\s\w])(?=\b(const|let|var|function|return|if|else|for|while|export|from|async|await|class|extends|new|throw|try|catch|finally|typeof|instanceof|of|in)\b)/g,'$1 ')
  c=c.replace(/\( import\.meta/g,'(import.meta')
  return{code:c,needsAI:true}
}
function compactPY(code){
  let c=code
  c=c.replace(/'''[\s\S]*?'''/g,'')
  c=c.replace(/"""[\s\S]*?"""/g,'')
  c=c.replace(/#.*$/gm,'')
  c=c.split('\n').filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:true}
}
function compactGO(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.split('\n').map(l=>l.trimEnd()).filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:true}
}
function compactRS(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.split('\n').map(l=>l.trimEnd()).filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:true}
}
function compactCSS(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('')
  c=c.replace(/\s*([{};:,>+~])\s*/g,'$1')
  return{code:c,needsAI:false}
}
function compactJSON(code){
  try{return{code:JSON.stringify(JSON.parse(code)),needsAI:false}}
  catch{return{code,needsAI:false}}
}
function compactHTML(code){
  let c=code
  c=c.replace(/<!--[\s\S]*?-->/g,'')
  c=c.replace(/>\s+</g,'><')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('')
  c=c.replace(/\s{2,}/g,' ')
  return{code:c,needsAI:false}
}
function compactYAML(code){
  let c=code
  c=c.replace(/#.*$/gm,'')
  c=c.split('\n').filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:false}
}
function compactSH(code){
  let c=code
  c=c.replace(/#.*$/gm,m=>m.startsWith('#!')?m:'')
  c=c.split('\n').filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:true}
}
function compactRuby(code){
  let c=code
  c=c.replace(/=begin[\s\S]*?=end/g,'')
  c=c.replace(/#.*$/gm,'')
  c=c.split('\n').filter(l=>l.trim()).join('\n')
  return{code:c,needsAI:true}
}
function compactPHP(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.replace(/#.*$/gm,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('\n')
  return{code:c,needsAI:true}
}
function compactJava(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('\n')
  return{code:c,needsAI:true}
}
function compactC(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('\n')
  return{code:c,needsAI:true}
}
function compactSwift(code){
  let c=code
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.replace(/\/\/.*$/gm,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join('\n')
  return{code:c,needsAI:true}
}
function compactSQL(code){
  let c=code
  c=c.replace(/--.*$/gm,'')
  c=c.replace(/\/\*[\s\S]*?\*\//g,'')
  c=c.split('\n').map(l=>l.trim()).filter(l=>l).join(' ')
  c=c.replace(/\s{2,}/g,' ')
  return{code:c,needsAI:false}
}
const COMPACT_PROMPT=`${PURE_MODE_INSTRUCTIONS}

Compact this code. Output ONLY the compacted code. No markdown, no explanations.

%CODE%`
async function aiCompact(code,ext){
  if(!model)initModel()
  const prompt=COMPACT_PROMPT.replace('%CODE%',code)
  const tracking=logLlmCall('GEMINI','compact',prompt.length,MODEL,'compact')
  try{
    const r=await model.generateContent(prompt)
    let t=r.response?.text?.()?.trim()||code
    t=t.replace(/^```\w*\n?/,'').replace(/\n?```$/,'')
    logLlmResponse(tracking,t)
    return t
  }catch(e){
    recordError({provider:'GEMINI',operation:'compact',operationType:'compact',error:e.message})
    return code
  }
}
export async function compactFile(filePath){
  const ext=getFileExtension(filePath)
  const og=fs.readFileSync(filePath,'utf8')
  const{code,needsAI}=programmaticCompact(og,ext)
  if(!needsAI)return{og,compacted:code,usedAI:false}
  const final=await aiCompact(code,ext)
  return{og,compacted:final,usedAI:true}
}
const ALL_EXTS=[...JS_EXTS,...PY_EXTS,...GO_EXTS,...RS_EXTS,...CSS_EXTS,...JSON_EXTS,...HTML_EXTS,...YAML_EXTS,...SH_EXTS,...RUBY_EXTS,...PHP_EXTS,...JAVA_EXTS,...C_EXTS,...SWIFT_EXTS,...SQL_EXTS]
function toTokens(chars){return Math.ceil(chars/3.5)}
export async function compactProject(root,opts={}){
  const{dryRun=false,verbose=false,aiLimit=Infinity}=opts
  const files=getAllFiles(root)
  const results={total:0,compacted:0,skipped:0,saved:0,ogBytes:0,finalBytes:0,errors:[],aiUsed:0,aiPending:[]}
  for(const f of files){
    results.total++
    const fp=path.join(root,f)
    const ext=getFileExtension(f)
    if(!ALL_EXTS.includes(ext)){
      results.skipped++
      if(verbose)console.log(`skip ${f}`)
      continue
    }
    try{
      const og=fs.readFileSync(fp,'utf8')
      const{code,needsAI}=programmaticCompact(og,ext)
      const skipAI=needsAI&&results.aiUsed>=aiLimit
      let final=code
      if(needsAI&&!skipAI){
        final=await aiCompact(code,ext)
        results.aiUsed++
      }
      if(skipAI)results.aiPending.push(f)
      results.ogBytes+=og.length
      results.finalBytes+=final.length
      const savedBytes=og.length-final.length
      if(savedBytes>0){
        results.compacted++
        results.saved+=savedBytes
        const pct=Math.round(savedBytes/og.length*100)
        const tkSaved=toTokens(savedBytes)
        if(verbose)console.log(`${skipAI?'SY':needsAI?'AI':'  '} ${f} -${tkSaved}tk (${pct}%)`)
        if(!dryRun){
          fs.writeFileSync(fp,final)
          if(!skipAI)markCompacted(root,f)
        }
      }else if(verbose){
        console.log(`   ${f} (no change)`)
      }
    }catch(e){
      results.errors.push({file:f,error:e.message})
      if(verbose)console.log(`ERR ${f}: ${e.message}`)
    }
  }
  results.ogTokens=toTokens(results.ogBytes)
  results.finalTokens=toTokens(results.finalBytes)
  results.savedTokens=results.ogTokens-results.finalTokens
  results.pct=results.ogTokens?Math.round(results.savedTokens/results.ogTokens*100):0
  return results
}
