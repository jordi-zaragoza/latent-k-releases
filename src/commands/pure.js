import {getPureMode,setPureMode} from '../lib/config.js'
import {listDomains,loadDomain} from '../lib/context.js'
const IS_BINARY=!!process.pkg
export async function pure(a,o={}){
  if(IS_BINARY){console.log('Pure mode: dev only');return}
  if(a==='status'){
    const m=getPureMode()
    const l=o.list
    console.log(`Pure mode: ${m?'ON':'OFF'}\n`)
    const r=process.cwd()
    const d=listDomains(r)
    let t=0
    const cF=[],p=[]
    for(const D of d){
      const dO=loadDomain(r,D)
      if(!dO)continue
      for(const i of Object.values(dO.groups)){
        for(const e of i){
          t++
          if(e.compacted)cF.push(e.path)
          else p.push(e.path)
        }
      }
    }
    console.log(`Files: ${t} total, ${cF.length} compacted (•), ${p.length} pending`)
    if(l){
      if(cF.length>0){
        console.log('\nCompacted (•):')
        cF.forEach(f=>console.log(`  ${f}`))
      }
      if(p.length>0){
        console.log('\nPending:')
        p.forEach(f=>console.log(`  ${f}`))
      }
    }else if(p.length>0&&p.length<=10){
      console.log('\nPending:')
      p.forEach(f=>console.log(`  ${f}`))
    }else if(p.length>10){
      console.log(`\nUse -l to list all files`)
    }
    return
  }
  const c=getPureMode()
  if(!a){
    console.log(`Pure mode: ${c?'ON':'OFF'}`)
    console.log('')
    console.log('Usage:')
    console.log('  lk pure on      - Enable m2m coding style')
    console.log('  lk pure off     - Disable (human-readable)')
    console.log('  lk pure status  - Show file stats')
    return
  }
  const e=a==='on'||a==='1'||a==='true'
  const d=a==='off'||a==='0'||a==='false'
  if(!e&&!d){console.log('Usage: lk pure [on|off|status]');return}
  setPureMode(e)
  console.log(`Pure mode: ${e?'ON':'OFF'}`)
  if(e){
    console.log('')
    console.log('Style: m2m, austere, dense')
    console.log('- No unnecessary comments')
    console.log('- Concise naming')
    console.log('- Minimal error messages')
    console.log('- No defensive coding for impossible states')
  }
}
