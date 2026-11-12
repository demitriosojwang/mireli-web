import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeBase32(bytes:Buffer):string {
  let bits=0,value=0,result="";
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31];}}
  if(bits)result+=alphabet[(value<<(5-bits))&31];return result;
}
function decodeBase32(secret:string):Buffer {
  if(!/^[A-Z2-7]{32}$/.test(secret))throw new Error("Invalid authenticator secret.");
  let bits=0,value=0;const bytes:number[]=[];
  for(const char of secret){value=(value<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}}
  return Buffer.from(bytes);
}
export function totpCode(secret:string,step:number,digits=6):string {
  if(!Number.isSafeInteger(step)||step<0||![6,8].includes(digits))throw new Error("Invalid authenticator counter.");
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const hash=createHmac("sha1",decodeBase32(secret)).update(counter).digest(),offset=hash[hash.length-1]&15;
  return ((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,"0");
}
export function matchTotp(secret:string,code:string,lastStep:number,now=Date.now()):number|null {
  if(!/^\d{6}$/.test(code))return null;
  const step=Math.floor(now/30000);
  for(const candidate of [step,step-1,step+1])if(candidate>lastStep && candidate>=0 && timingSafeEqual(Buffer.from(totpCode(secret,candidate)),Buffer.from(code)))return candidate;
  return null;
}
function encryptionKey():Buffer {
  const value=process.env.STAFF_MFA_ENCRYPTION_KEY??"",key=Buffer.from(value,"base64");
  if(key.length!==32||key.toString("base64")!==value)throw new Error("Staff encryption is not configured.");return key;
}
export function mfaEncryptionConfigured():boolean {try{return encryptionKey().length===32;}catch{return false;}}
export function encryptMfaSecret(accountId:string,secret:string):string {
  decodeBase32(secret);const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);cipher.setAAD(Buffer.from(accountId));
  const bytes=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
}
export function decryptMfaSecret(accountId:string,value:string):string {
  if(!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(value))throw new Error("Invalid authenticator encryption.");
  const [,iv,tag,encrypted]=value.split("."),cipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64url"));
  cipher.setAAD(Buffer.from(accountId));cipher.setAuthTag(Buffer.from(tag,"base64url"));
  const secret=Buffer.concat([cipher.update(Buffer.from(encrypted,"base64url")),cipher.final()]).toString("utf8");decodeBase32(secret);return secret;
}
