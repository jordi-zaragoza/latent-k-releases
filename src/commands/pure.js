import {getPureMode,setPureMode} from '../lib/config.js'
import {compactProject,compactFile} from '../lib/compact.js'
import {markCompacted,listDomains,loadDomain} from '../lib/context.js'
import {writeFileSync} from 'fs'
import path from 'path'
const IS_BINARY=!!process.pkg
export async function pure(action,opts={}){
  if(IS_BINARY){console.log('Pure mode: dev only');return}
  if(action==='status'){
    const mode=getPureMode()
    const list=opts.list
    console.log(`Pure mode: ${mode?'ON':'OFF'}\n`)
    const root=process.cwd()
    const domains=listDomains(root)
    let total=0
    const compactedFiles=[],pending=[]
    for(const d of domains){
      const dom=loadDomain(root,d)
      if(!dom)continue
      for(const items of Object.values(dom.groups)){
        for(const e of items){
          total++
          if(e.compacted)compactedFiles.push(e.path)
          else pending.push(e.path)
        }
      }
    }
    console.log(`Files: ${total} total, ${compactedFiles.length} compacted (•), ${pending.length} pending`)
    if(list){
      if(compactedFiles.length>0){
        console.log('\nCompacted (•):')
        compactedFiles.forEach(f=>console.log(`  ${f}`))
      }
      if(pending.length>0){
        console.log('\nPending:')
        pending.forEach(f=>console.log(`  ${f}`))
      }
    }else if(pending.length>0&&pending.length<=10){
      console.log('\nPending:')
      pending.forEach(f=>console.log(`  ${f}`))
    }else if(pending.length>10){
      console.log(`\nUse -l to list all files`)
    }
    return
  }
  if(action==='compact'){
    const file=opts.file
    if(file){
      const fp=path.resolve(file)
      console.log(`Compacting ${file}...\n`)
      const{og,compacted,usedAI}=await compactFile(fp)
      const saved=og.length-compacted.length
      const pct=Math.round(saved/og.length*100)
      console.log(`Original: ${og.length}b`)
      console.log(`Compacted: ${compacted.length}b`)
      console.log(`Saved: ${saved}b (${pct}%)`)
      console.log(`AI: ${usedAI?'yes':'no'}`)
      if(!opts.dryRun){
        writeFileSync(fp,compacted)
        const rel=path.relative(process.cwd(),fp)
        markCompacted(process.cwd(),rel)
        console.log('\nFile updated & marked as compacted.')
      }else{
        console.log('\n--- Preview ---')
        console.log(compacted.slice(0,2000))
        if(compacted.length>2000)console.log(`\n... (${compacted.length-2000} more chars)`)
      }
      return
    }
    const aiLimit=opts.all?Infinity:5
    console.log(`Compacting project...${opts.all?'':' (AI limit: 5)'}\n`)
    const r=await compactProject(process.cwd(),{dryRun:opts.dryRun,verbose:true,aiLimit})
    console.log(`\n${r.compacted}/${r.total} files compacted`)
    console.log(`${r.skipped} skipped, ${Math.round(r.saved/1024)}KB saved`)
    if(r.aiPending.length)console.log(`${r.aiPending.length} pending (need AI)`)
    if(r.errors.length)console.log(`${r.errors.length} errors`)
    if(opts.dryRun)console.log('\n(dry run - no files modified)')
    return
  }
  const current=getPureMode()
  if(!action){
    console.log(`Pure mode: ${current?'ON':'OFF'}`)
    console.log('')
    console.log('Usage:')
    console.log('  lk pure on              - Enable m2m coding style')
    console.log('  lk pure off             - Disable (human-readable)')
    console.log('  lk pure status          - Show compact/verbose stats')
    console.log('  lk pure compact         - Compact (5 AI files max)')
    console.log('  lk pure compact -a      - Compact all (unlimited AI)')
    console.log('  lk pure compact <file>  - Compact single file')
    console.log('  lk pure compact -n      - Dry run (preview)')
    return
  }
  const enable=action==='on'||action==='1'||action==='true'
  const disable=action==='off'||action==='0'||action==='false'
  if(!enable&&!disable){console.log('Usage: lk pure [on|off|compact]');return}
  setPureMode(enable)
  console.log(`Pure mode: ${enable?'ON':'OFF'}`)
  if(enable){
    console.log('')
    console.log('Style: m2m, austere, dense')
    console.log('- No unnecessary comments')
    console.log('- Concise naming')
    console.log('- Minimal error messages')
    console.log('- No defensive coding for impossible states')
  }
}
