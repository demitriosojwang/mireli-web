import {afterEach,describe,expect,it,vi} from "vitest";
import {encodeBase32,totpCode,matchTotp,encryptMfaSecret,decryptMfaSecret} from "@/lib/staff/mfa";
afterEach(()=>vi.unstubAllEnvs());
describe("staff MFA",()=>{
  const secret=encodeBase32(Buffer.from("12345678901234567890"));
  it.each([[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"]])("matches RFC 6238 SHA1 vector %s",(seconds,code)=>{
    expect(totpCode(secret,Math.floor(Number(seconds)/30),8)).toBe(code);
  });
  it("accepts a current six-digit code but rejects reuse and unrelated codes",()=>{
    const now=Date.now(),step=Math.floor(now/30000),code=totpCode(secret,step);
    expect(matchTotp(secret,code,-1,now)).toBe(step);
    expect(matchTotp(secret,code,step,now)).toBeNull();
    expect(matchTotp(secret,"1234",-1,now)).toBeNull();
  });
  it("encrypts secrets with account-bound authenticated encryption",()=>{
    vi.stubEnv("STAFF_MFA_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
    const encrypted=encryptMfaSecret("staff-a",secret);expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret("staff-a",encrypted)).toBe(secret);
    expect(()=>decryptMfaSecret("staff-b",encrypted)).toThrow();
    expect(()=>decryptMfaSecret("staff-a",encrypted+"x")).toThrow();
  });
  it("refuses a missing encryption key",()=>{vi.stubEnv("STAFF_MFA_ENCRYPTION_KEY","");expect(()=>encryptMfaSecret("staff-a",secret)).toThrow();});
});
