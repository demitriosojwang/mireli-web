import {afterEach,describe,expect,it,vi} from "vitest";
import {emailAddress,sendEmailCode,emailSignInConfigured} from "@/lib/driver/email";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("Brevo verification",()=>{
  it("normalizes addresses and rejects header injection and invalid input",()=>{
    expect(emailAddress(" Driver@Example.com ")).toBe("driver@example.com");
    for(const value of ["bad", "a@b", "a@example.com\r\nBcc: x@example.com", "<script>@example.com", null])expect(()=>emailAddress(value)).toThrow();
  });
  it("requires real server configuration",()=>{
    vi.stubEnv("BREVO_API_KEY","");vi.stubEnv("BREVO_SENDER_EMAIL","");
    expect(emailSignInConfigured()).toBe(false);
  });
  it("sends a branded code with a plain-text fallback and server credentials",async()=>{
    vi.stubEnv("BREVO_API_KEY","private-test-key");vi.stubEnv("BREVO_SENDER_EMAIL","login@example.com");
    const fetchMock=vi.fn().mockResolvedValue({ok:true,status:201,json:async()=>({messageId:"accepted"})});vi.stubGlobal("fetch",fetchMock);
    await sendEmailCode("driver@example.com","123456");
    const [url,options]=fetchMock.mock.calls[0];expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const body=JSON.parse(options.body);expect(body.to).toEqual([{email:"driver@example.com"}]);
    expect(body.textContent).toContain("123456");expect(body).not.toHaveProperty("apiKey");
    expect(options.headers["api-key"]).toBe("private-test-key");
    expect(body.htmlContent).toContain("https://mireli.online/mireli-logo.jpeg");
    expect(body.htmlContent).toContain("123456");
    expect(body.htmlContent).toContain("Your driver sign-in code");
  });
  it("does not expose provider errors or accept a missing message receipt",async()=>{
    vi.stubEnv("BREVO_API_KEY","private-test-key");vi.stubEnv("BREVO_SENDER_EMAIL","login@example.com");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({message:"private-test-key"})}));
    await expect(sendEmailCode("driver@example.com","123456")).rejects.toMatchObject({code:"EMAIL_UNAVAILABLE"});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,status:201,json:async()=>({})}));
    await expect(sendEmailCode("driver@example.com","123456")).rejects.toMatchObject({code:"EMAIL_UNAVAILABLE"});
  });
});
