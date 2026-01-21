import crypto from 'crypto';
import os from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const ALGORITHM='aes-256-gcm';
const IV_LENGTH=16;
const SALT_LENGTH=16;
const KEY_LENGTH=32;
const PBKDF2_ITERATIONS=100000;
let cachedKey=null;
let cachedKeyId=null;
let cachedInstallationSalt=null;
function getInstallationSalt(){
  if(cachedInstallationSalt) return cachedInstallationSalt;
  const dir=join(os.homedir(),'.lk');
  const p=join(dir,'.salt');
  if(existsSync(p)) {
    try {
      const slt=readFileSync(p,'utf8').trim();
      if(slt.length>=64) {
        cachedInstallationSalt=slt;
        return slt;
      }
    } catch {}
  }
  const nSlt=crypto.randomBytes(64).toString('hex');
  try {
    mkdirSync(dir,{recursive:true,mode:0o700});
    writeFileSync(p,nSlt,{mode:0o600});
  } catch {}
  cachedInstallationSalt=nSlt;
  return nSlt;
}
function deriveKey(){
  const kId=getDeviceId();
  if(cachedKey&&cachedKeyId===kId) return cachedKey;
  const slt=crypto.createHash('sha256').update(kId+'-lk-salt-v2').digest().subarray(0,SALT_LENGTH);
  cachedKey=crypto.pbkdf2Sync(kId,slt,PBKDF2_ITERATIONS,KEY_LENGTH,'sha256');
  cachedKeyId=kId;
  return cachedKey;
}
function getDeviceId(){
  const host=os.hostname();
  const user=os.userInfo().username;
  const plat=os.platform();
  const a=os.arch();
  const iSlt=getInstallationSalt();
  const b=`${host}:${user}:${plat}:${a}:${iSlt}`;
  return crypto.createHash('sha256').update(b).digest('hex');
}
export function encrypt(c){
  const k=deriveKey();
  const v=crypto.randomBytes(IV_LENGTH);
  const ci=crypto.createCipheriv(ALGORITHM,k,v);
  const e=Buffer.concat([ci.update(c,'utf8'),ci.final()]);
  const tag=ci.getAuthTag();
  const r=Buffer.concat([v,tag,e]);
  return r.toString('base64');
}
export function decrypt(c){
  if(!c) throw new Error('No content to decrypt');
  const d=Buffer.from(c,'base64');
  if(d.length<33) throw new Error('Invalid encrypted content');
  const v=d.subarray(0,16);
  const tag=d.subarray(16,32);
  const e=d.subarray(32);
  const k=deriveKey();
  const de=crypto.createDecipheriv(ALGORITHM,k,v);
  de.setAuthTag(tag);
  const dC=Buffer.concat([de.update(e),de.final()]);
  return dC.toString('utf8');
}
export function isEncryptionEnabled(){return true;}
export function getDeviceIdentifier(){return getDeviceId();}
export function clearKeyCache(){cachedKey=null;cachedKeyId=null;cachedInstallationSalt=null;}