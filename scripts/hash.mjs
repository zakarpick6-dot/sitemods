import crypto from 'node:crypto';
const s=crypto.randomBytes(16).toString('hex');
console.log(s+':'+crypto.scryptSync(process.argv[2]||'',s,64).toString('hex'));
