import {listDomains,loadDomain,getProjectPureMode,setProjectPureMode,exists,validateProjectDirectory,isHomeOrRoot} from '../lib/context.js'
const IS_BINARY=!!process.pkg
export async function pure(a,o={}){
  if(IS_BINARY){console.log('Pure mode: dev only');return}
  const root=process.cwd()
  if(isHomeOrRoot(root)){console.log('Cannot run in home/root directory');return}
  if(a==='status'){
    const m=getProjectPureMode(root)
    const l=o.list
    console.log(`Pure mode: ${m?'ON':'OFF'} (project-level)\n`)
    const d=listDomains(root)
    let t=0
    const cF=[],p=[]
    for(const D of d){
      const dO=loadDomain(root,D)
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
  const c=getProjectPureMode(root)
  if(!a){
    console.log(`Pure mode: ${c?'ON':'OFF'} (project-level)`)
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
  if(!exists(root)){
    const v=validateProjectDirectory(root)
    if(!v.valid){console.log(v.reason==='no_project_markers'?'Not a project directory (no package.json, etc.)':'Invalid directory');return}
  }
  setProjectPureMode(root,e)
  console.log(`Pure mode: ${e?'ON':'OFF'} (project-level)`)
  if(e){
    console.log('')
    console.log('Style: m2m, austere, dense')
    console.log('- No unnecessary comments')
    console.log('- Concise naming')
    console.log('- Minimal error messages')
    console.log('- No defensive coding for impossible states')
  }
}
