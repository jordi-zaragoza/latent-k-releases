import { createInterface } from 'readline';
import { activateLicense, isLicensed, clearLicense } from '../lib/license.js';
import { getClaudeUserEmail } from '../lib/claude-utils.js';
let rl = null;
const question=p=>new Promise(r=>rl.question(p,r));
export async function activate() {
  rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('lk activation\n');
  if (isLicensed()) {
    const a=await question('Already activated. Re-activate? (y/N): ');
    if(a.toLowerCase()!=='y'){
      rl.close();
      return;
    }
    clearLicense();
  }
  console.log('Get your license key at: https://latent-k.pages.dev/activation\n');
  const l=await question('Enter license key: ');
  if(!l.trim()){
    console.log('No key provided. Cancelled.');
    rl.close();
    return;
  }
  console.log('\nActivating...');
  const u=getClaudeUserEmail();
  const r=await activateLicense(l.trim(),u);
  if(r.success){
    console.log('License activated successfully!');
    console.log('\nNext: run "lk setup" to configure.');
  }else{
    console.log(`Activation failed: ${r.error}`);
  }
  rl.close();
}