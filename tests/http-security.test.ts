import {afterEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {contentSecurityPolicy,rejectBrowserMutation} from "@/lib/http-security";
import {proxy} from "@/proxy";
import {GET,POST} from "@/app/api/v1/driver/[...path]/route";
import {driverPhoneSignInConfigured,driverRegistrationConfigured,driverServiceStatus,securePolicyUrl} from "@/lib/driver/readiness";
import {text} from "@/lib/driver/errors";
import {POLICY_VERSION} from "@/lib/driver/catalogue";

afterEach(()=>vi.unstubAllEnvs());
const origin="https://mireli.example";
const context=(path:string)=>({params:Promise.resolve({path:path.split("/")})});
const request=(headers:Record<string,string>)=>new Request(`${origin}/api/admin/drivers`,{method:"POST",headers});

describe("browser security boundary",()=>{
  it("blocks foreign and missing origins for cookie-authenticated mutations",()=>{
    expect(rejectBrowserMutation(request({cookie:"mireli_admin=token",origin:"https://evil.example"}),origin)).toBe(true);
    expect(rejectBrowserMutation(request({cookie:"mireli_admin=token"}),origin)).toBe(true);
    expect(rejectBrowserMutation(request({cookie:"mireli_admin=token",origin}),origin)).toBe(false);
    expect(rejectBrowserMutation(request({origin:"null"}),origin)).toBe(true);
    expect(rejectBrowserMutation(request({authorization:"Bearer token"}),origin)).toBe(false);
  });
  it("uses distinct nonces, ignores caller CSP, and blocks injected scripts",()=>{
    vi.stubEnv("NODE_ENV","production");
    const a=proxy(new NextRequest(origin,{headers:{"x-nonce":"attacker","content-security-policy":"script-src * 'unsafe-inline'"}}));
    const b=proxy(new NextRequest(origin));
    const csp=a.headers.get("content-security-policy")!;
    expect(csp).not.toBe(b.headers.get("content-security-policy"));
    expect(csp).toContain("script-src-attr 'none'");expect(csp).toContain("object-src 'none'");
    expect(csp.split(";").map(p=>p.trim()).find(p=>p.startsWith("script-src "))).not.toMatch(/unsafe-inline|unsafe-eval|attacker/);
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(()=>contentSecurityPolicy("injected'; script-src *",false)).toThrow();
  });
  it("rejects cookie CSRF at the proxy before reaching an API",()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("MIRELI_PUBLIC_ORIGIN",origin);
    const result=proxy(new NextRequest(`${origin}/api/admin/drivers`,{method:"POST",headers:{cookie:"mireli_admin=token",origin:"https://evil.example"}}));
    expect(result.status).toBe(403);expect(result.headers.get("cache-control")).toBe("no-store");
  });
});

describe("untrusted driver API requests do not reach a database",()=>{
  it.each([
    {type:"text/plain",body:'{"phone":"0712345678"}',status:415},
    {type:"application/json",body:'["0712345678"]',status:400},
    {type:"application/json",body:JSON.stringify({phone:"' OR 1=1 --"}),status:400},
    {type:"application/json",body:JSON.stringify({phone:"<script>alert(1)</script>"}),status:400},
    {type:"application/json",body:"x".repeat(16385),status:413},
  ])("rejects $type with expected status $status",async({type,body,status})=>{
    const response=await POST(new Request(`${origin}/api/v1/driver/auth/challenges`,{method:"POST",headers:{"content-type":type},body}),context("auth/challenges"));
    expect(response.status).toBe(status);
  });
  it("does not treat SQL-shaped credentials as a session",async()=>{
    const response=await GET(new Request(`${origin}/api/v1/driver/me`,{headers:{authorization:"Bearer ' OR 1=1 --"}}),context("me"));
    expect(response.status).toBe(401);
  });
  it("requires a driver session before route requests can reach trip or routing services",async()=>{
    const response=await POST(new Request(`${origin}/api/v1/driver/navigation/route`,{method:"POST",headers:{authorization:"Bearer invalid-token","content-type":"application/json"},body:"{}"}),context("navigation/route"));
    expect(response.status).toBe(401);
  });
  it("retains apostrophes as data while rejecting malformed types and controls",()=>{
    expect(text("O'Connor","Name",2,100)).toBe("O'Connor");
    expect(()=>text({$ne:null},"Name",2,100)).toThrow();
    expect(()=>text("Name\u0000","Name",2,100)).toThrow();
  });
  it("reports closed registration when production prerequisites are absent",async()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("MIRELI_DEMO_MODE","false");vi.stubEnv("DRIVER_AUTH_SECRET","");
    const response=await GET(new Request(`${origin}/api/v1/driver/status`),context("status"));
    const body=await response.json();expect(body.registrationOpen).toBe(false);expect(body.phoneSignInOpen).toBe(false);expect(body.simulation).toBe(false);
    expect(body).not.toHaveProperty("DRIVER_AUTH_SECRET");
  });
  it("keeps existing-driver sign-in independent from paused new-driver intake",()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("MIRELI_DEMO_MODE","false");
    vi.stubEnv("DRIVER_AUTH_SECRET","a".repeat(48));vi.stubEnv("AT_USERNAME","configured");vi.stubEnv("AT_API_KEY","configured");
    expect(driverPhoneSignInConfigured()).toBe(true);
    expect(driverRegistrationConfigured()).toBe(false);
    expect(driverServiceStatus()).toMatchObject({phoneSignInOpen:true,registrationOpen:false});
  });
  it("requires private storage and reviewed HTTPS policies before opening registration",()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("MIRELI_DEMO_MODE","false");
    Object.entries({DRIVER_AUTH_SECRET:"a".repeat(48),AT_USERNAME:"configured",AT_API_KEY:"configured",AWS_REGION:"eu-west-1",DRIVER_DOCUMENT_BUCKET:"private",DRIVER_POLICY_VERSION:POLICY_VERSION,DRIVER_PRIVACY_URL:`${origin}/privacy`,DRIVER_TERMS_URL:`${origin}/terms`}).forEach(([k,v])=>vi.stubEnv(k,v));
    vi.stubEnv("DRIVER_SCAN_COMMAND","/usr/bin/clamscan");vi.stubEnv("DRIVER_COMPLIANCE_REVIEWERS","compliance@example.com");
    // Every prerequisite is satisfied here, staff authentication included, so intake opens.
    // Dropping any single prerequisite must close it again (private storage is checked next).
    expect(driverRegistrationConfigured()).toBe(true);
    vi.stubEnv("DRIVER_DOCUMENT_BUCKET","");expect(driverRegistrationConfigured()).toBe(false);
    expect(securePolicyUrl("javascript:alert(1)")).toBe(false);expect(securePolicyUrl("https://user:password@example.com")).toBe(false);
  });
});
