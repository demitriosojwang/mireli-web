import {describe,it,expect,vi,afterEach} from "vitest";
import {phoneNumber,challengeHash,matchesChallenge,hashToken} from "@/lib/driver/auth";
import {validFile,applicableRequirements} from "@/lib/driver/catalogue";
import {minor} from "@/lib/driver/earnings";
import {calculateSettlement,classifySubmission} from "@/lib/payout-settlement";
import {evaluateDriverApplication} from "@/lib/driver/onboarding";
import {POLICY_VERSION} from "@/lib/driver/catalogue";
afterEach(()=>vi.unstubAllEnvs());
describe("driver identity and evidence",()=>{
  it("accepts Kenyan formats and rejects injected or foreign numbers",()=>{
    expect(phoneNumber("0712345678")).toBe("+254712345678");
    expect(()=>phoneNumber("0712345678<script>")).toThrow();
    expect(()=>phoneNumber("+12345678901")).toThrow();
  });
  it("binds OTP hashes to a challenge and does not accept a different code",()=>{
    vi.stubEnv("DRIVER_AUTH_SECRET","a".repeat(64));
    const hash=challengeHash("challenge-one","123456");
    expect(matchesChallenge("challenge-one","123456",hash)).toBe(true);
    expect(matchesChallenge("challenge-two","123456",hash)).toBe(false);
    expect(matchesChallenge("challenge-one","654321",hash)).toBe(false);
    expect(matchesChallenge("challenge-one","123456","bad")).toBe(false);
    expect(hashToken("raw-token")).not.toContain("raw-token");
  });
  it("rejects renamed executable files",()=>{
    expect(validFile("application/pdf",Buffer.from("MZ executable"))).toBe(false);
    expect(validFile("application/pdf",Buffer.from("%PDF-1.7\nfixture"))).toBe(true);
    expect(validFile("image/png",Buffer.from("not a PNG"))).toBe(false);
  });
  it("requires ownership evidence conditionally and leaves medical optional",()=>{
    expect(applicableRequirements(true).some(r=>r.id==="lease")).toBe(false);
    expect(applicableRequirements(false).some(r=>r.id==="lease")).toBe(true);
    expect(applicableRequirements(true).find(r=>r.id==="medical")?.required).toBe(false);
  });
  it("requires approved current evidence instead of a cached active flag",()=>{
    const now=new Date("2026-10-06T00:00:00Z");
    const app={status:"approved",policyVersion:POLICY_VERSION,ownsVehicle:true,documents:applicableRequirements(true).filter(r=>r.required).map(r=>({type:r.id,state:"approved",scanState:"clean",expiresAt:r.expires?new Date("2028-12-31T00:00:00Z"):null}))};
    expect(evaluateDriverApplication(app,"active",now,false).eligible).toBe(true);
    expect(evaluateDriverApplication(null,"active",now,false).eligible).toBe(false);
    expect(evaluateDriverApplication(app,"suspended",now,false).eligible).toBe(false);
    expect(evaluateDriverApplication({...app,policyVersion:"old-policy"},"active",now,false).eligible).toBe(false);
    expect(evaluateDriverApplication({...app,documents:app.documents.map(d=>d.type==="licence"?{...d,expiresAt:new Date("2020-01-01")}:d)},"active",now,false).eligible).toBe(false);
    expect(evaluateDriverApplication({...app,documents:app.documents.map(d=>({...d,scanState:"clean_demo"}))},"active",now,false).eligible).toBe(false);
  });
});
describe("settlement proof",()=>{
  it("keeps the per-seat booking fee and passes the full pooled fare and home surcharge to the driver",()=>{
    expect(calculateSettlement(1200,100,100,1000,false)).toEqual({gross:1200,surcharge:100,platformFee:100,commission:0,net:1100});
  });
  it("includes the booking fee within the charter's 10% platform share and sends the remainder to the driver",()=>{
    expect(calculateSettlement(1100,100,50,1000,true)).toEqual({gross:1100,surcharge:100,platformFee:50,commission:50,net:1000});
    expect(calculateSettlement(2000,0,50,1000,true)).toEqual({gross:2000,surcharge:0,platformFee:50,commission:150,net:1800});
    expect(()=>calculateSettlement(400,0,50,1000,true)).toThrow();
  });
  it("rejects corrupt values and overflow",()=>{
    expect(()=>calculateSettlement(100,200,0,1500,true)).toThrow();
    expect(()=>calculateSettlement(100,0,101,1500,true)).toThrow();
    expect(()=>calculateSettlement(-1,0,0,1500,true)).toThrow();
    expect(()=>calculateSettlement(Number.MAX_SAFE_INTEGER,0,0,10000,true)).toThrow();
    expect(()=>minor(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(minor(123)).toBe(12300);
  });
  it("does not turn accepted or unknown requests into paid funds",()=>{
    expect(classifySubmission({resultCode:"ACCEPTED",resultDesc:"Accepted",conversationId:"provider-id"})).toBe("processing");
    expect(classifySubmission({resultCode:"0",resultDesc:"Accepted"})).toBe("ambiguous");
    expect(classifySubmission({resultCode:"1007",resultDesc:"Timeout"})).toBe("ambiguous");
  });
  it("requires explicit settled proof even in simulation",()=>{
    expect(classifySubmission({resultCode:"0",resultDesc:"Mock",settled:true,receipt:"DEMO123456"})).toBe("completed");
    expect(classifySubmission({resultCode:"1001",resultDesc:"Invalid receiver"})).toBe("failed");
  });
});
