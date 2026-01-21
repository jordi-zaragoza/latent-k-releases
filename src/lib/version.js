import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname,join} from 'path';
let v;
try{
if(typeof __VERSION__!='undefined')v=__VERSION__;
else v=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'../../package.json'),'utf8')).version;
}catch{v='0.0.0'}
export const VERSION=v;