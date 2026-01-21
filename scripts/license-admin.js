#!/usr/bin/env node
import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
const kD=join(homedir(),'.lk-keys')
const pKP=join(kD,'private.pem')
const puKP=join(kD,'public.pem')
export function generateKeyPair(){
  if(!existsSync(kD)){
    mkdirSync(kD,{recursive:true,mode:0o700})
  }
  if(existsSync(pKP)){
    console.log('Keys already exist at:',kD)
    return {privateKey:readFileSync(pKP,'utf8'),publicKey:readFileSync(puKP,'utf8')}
  }
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  writeFileSync(pKP,privateKey,{mode:0o600})
  writeFileSync(puKP,publicKey,{mode:0o644})
  console.log('Generated new key pair at:',kD)
  console.log('\nIMPORTANT: Keep private.pem safe! Never share it.')
  console.log('Copy public.pem content to src/lib/license-gen.js EMBEDDED_PUBLIC_KEY\n')
  return {privateKey,publicKey}
}
function getPrivateKey(){
  if(!existsSync(pKP)){
    throw new Error('No private key found. Run: node scripts/license-admin.js keys')
  }
  return readFileSync(pKP,'utf8')
}
function getPublicKey(){
  if(!existsSync(puKP)){
    throw new Error('No public key found. Run: node scripts/license-admin.js keys')
  }
  return readFileSync(puKP,'utf8')
}
export function generateLicense(o={}){
  if(!o.email){
    throw new Error('Email is required for license generation')
  }
  const pK=getPrivateKey()
  let e=o.expires||null
  if(o.durationDays&&!e){
    e=Date.now()+o.durationDays*24*60*60*1000
  }
  const d={
    id:randomBytes(8).toString('hex'),
    type:o.type||'standard',
    email:o.email.toLowerCase().trim(),
    created:Date.now(),
    expires:e
  }
  const p=Buffer.from(JSON.stringify(d)).toString('base64url')
  const s=createSign('SHA256')
  s.update(p)
  const sig=s.sign(pK,'base64url')
  return `LK-${p}.${sig}`
}
export function validateLicenseOffline(k){
  try{
    if(!k||!k.startsWith('LK-')){
      return {valid:false,error:'Invalid format'}
    }
    const pt=k.slice(3).split('.')
    if(pt.length!==2){
      return {valid:false,error:'Invalid format'}
    }
    const [p,sig]=pt
    const puK=getPublicKey()
    const v=createVerify('SHA256')
    v.update(p)
    if(!v.verify(puK,sig,'base64url')){
      return {valid:false,error:'Invalid signature'}
    }
    const d=JSON.parse(Buffer.from(p,'base64url').toString())
    if(d.expires&&Date.now()>d.expires){
      return {valid:false,error:'License expired',data:d}
    }
    return {valid:true,data:d}
  }catch(er){
    return {valid:false,error:er.message}
  }
}
export function parseLicense(k){
  try{
    if(!k||!k.startsWith('LK-'))return null
    const p=k.slice(3).split('.')[0]
    return JSON.parse(Buffer.from(p,'base64url').toString())
  }catch{
    return null
  }
}
export function generateBatch(c,o={}){
  const ls=[]
  for(let i=0;i<c;i++){
    ls.push(generateLicense({
      email:o.email,
      type:o.type,
      durationDays:o.durationDays,
      expires:o.expires
    }))
  }
  return ls
}
function parseArgs(a){
  const o={}
  for(let i=0;i<a.length;i++){
    if(a[i]==='--email'&&a[i+1])o.email=a[++i]
    else if(a[i]==='--type'&&a[i+1])o.type=a[++i]
    else if(a[i]==='--days'&&a[i+1])o.durationDays=parseInt(a[++i],10)
  }
  return o
}
function cli(){
  const [,,cmd,...a]=process.argv
  switch(cmd){
    case 'keys':generateKeyPair();break
    case 'generate':{
      const o=parseArgs(a)
      const l=generateLicense(o)
      console.log('\nGenerated license:')
      console.log(l)
      console.log('\nLicense data:')
      console.log(parseLicense(l))
      break
    }
    case 'batch':{
      const c=parseInt(a[0],10)||1
      const o=parseArgs(a.slice(1))
      const ls=generateBatch(c,o)
      console.log(`\nGenerated ${c} licenses:\n`)
      ls.forEach((l,i)=>{
        console.log(`${i+1}. ${l}`)
      })
      break
    }
    case 'verify':{
      const k=a[0]
      if(!k){
        console.error('Usage: license-admin.js verify <license-key>')
        process.exit(1)
      }
      const r=validateLicenseOffline(k)
      console.log('\nValidation result:')
      console.log(r)
      break
    }
    default:
      console.log(`
License Administration Tool
Usage:
  node scripts/license-admin.js keys                    Generate RSA key pair
  node scripts/license-admin.js generate [options]      Generate a license
  node scripts/license-admin.js batch <count> [options] Generate multiple licenses
  node scripts/license-admin.js verify <key>            Verify a license
Options:
  --email <email>   Set license email
  --type <type>     Set license type (standard, pro, etc.)
  --days <days>     Set expiration in days from now
`)
  }
}
if(process.argv[1]?.includes('license-admin')){
  cli()
}