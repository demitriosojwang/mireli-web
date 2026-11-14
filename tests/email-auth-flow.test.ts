import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rate:vi.fn(),create:vi.fn(),find:vi.fn(),update:vi.fn(),claim:vi.fn(),driverFind:vi.fn(),driverCreate:vi.fn(),driverUpdate:vi.fn(),application:vi.fn(),revoke:vi.fn(),session:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/db",()=>{
  const db={driverRateLimit:{upsert:mocks.rate},driverAuthChallenge:{create:mocks.create,findUnique:mocks.find,update:mocks.update,updateMany:mocks.claim},driver:{findUnique:mocks.driverFind,create:mocks.driverCreate,update:mocks.driverUpdate},driverApplication:{upsert:mocks.application},driverSession:{updateMany:mocks.revoke,create:mocks.session}};
  return {db:{...db,$transaction:async(fn:(tx:typeof db)=>unknown)=>fn(db)}};
});
vi.mock("@/lib/driver/email",async(importOriginal)=>({...await importOriginal<object>(),sendEmailCode:mocks.send}));
import {challengeHash,requestEmailChallenge,verifyChallenge} from "@/lib/driver/auth";
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("NODE_ENV","production");vi.stubEnv("DRIVER_AUTH_SECRET","a".repeat(48));vi.stubEnv("BREVO_API_KEY","test-only");vi.stubEnv("BREVO_SENDER_EMAIL","login@example.com");
  mocks.rate.mockResolvedValue({count:1});mocks.create.mockImplementation(async({data})=>data);mocks.send.mockResolvedValue(undefined);mocks.claim.mockResolvedValue({count:1});
});
afterEach(()=>vi.unstubAllEnvs());
describe("email auth boundaries",()=>{
  it("stores a hash, sends one email, and never returns the OTP",async()=>{
    const result=await requestEmailChallenge("Driver@Example.com");
    expect(mocks.send).toHaveBeenCalledOnce();expect(result).not.toHaveProperty("demoCode");
    const [email,code]=mocks.send.mock.calls[0];expect(email).toBe("driver@example.com");
    const data=mocks.create.mock.calls[0][0].data;expect(data.codeHash).toBe(challengeHash(result.challengeId,code));expect(data).not.toHaveProperty("phone");expect(data.codeHash).not.toBe(code);
  });
  it("blocks provider calls when rate limited",async()=>{
    mocks.rate.mockResolvedValue({count:13});await expect(requestEmailChallenge("driver@example.com")).rejects.toMatchObject({status:429});expect(mocks.send).not.toHaveBeenCalled();
  });
  it("invalidates a challenge after delivery failure",async()=>{
    mocks.send.mockRejectedValue(new Error("Provider failure"));await expect(requestEmailChallenge("driver@example.com")).rejects.toThrow();expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({data:{consumedAt:expect.any(Date)}}));
  });
  it("authenticates only the verified email identity, with single-use claim",async()=>{
    const id="a".repeat(48),email="driver@example.com";
    mocks.find.mockResolvedValue({id,email,channel:"email",phone:null,codeHash:challengeHash(id,"123456"),expiresAt:new Date(Date.now()+60000),consumedAt:null,attempts:0});
    mocks.driverFind.mockResolvedValue({id:"driver-id"});mocks.driverUpdate.mockResolvedValue({id:"driver-id",email,name:"Driver",phone:null});
    const result=await verifyChallenge({challengeId:id,code:"123456",deviceId:"device-12345"});
    expect(mocks.driverFind).toHaveBeenCalledWith({where:{email}});expect(mocks.driverCreate).not.toHaveBeenCalled();expect(result.token).toHaveLength(43);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({consumedAt:null}),data:{consumedAt:expect.any(Date)}}));
  });
  it("binds sign-in intent to the challenge and never creates a missing account", async () => {
    const { challengeId } = await requestEmailChallenge("driver@example.com", "sign_in");
    const code = mocks.send.mock.calls[0][1];
    const record = mocks.create.mock.calls[0][0].data;
    expect(record.channel).toBe("driver_sign_in");
    mocks.find.mockResolvedValue({ ...record, consumedAt: null, attempts: 0 });
    mocks.driverFind.mockResolvedValue(null);
    await expect(verifyChallenge({ challengeId, code, deviceId: "device-12345", intent: "register" }))
      .rejects.toMatchObject({ code: "DRIVER_ACCOUNT_REQUIRED" });
    expect(mocks.driverCreate).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("creates an account after verifying a registration challenge while intake is open", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MIRELI_DEMO_MODE", "true");
    const { challengeId, demoCode } = await requestEmailChallenge("new@example.com", "register");
    const record = mocks.create.mock.calls[0][0].data;
    expect(record.channel).toBe("driver_register");
    mocks.find.mockResolvedValue({ ...record, consumedAt: null, attempts: 0 });
    mocks.driverFind.mockResolvedValue(null);
    mocks.driverCreate.mockResolvedValue({ id: "created", email: record.email });
    const result = await verifyChallenge({ challengeId, code: demoCode, deviceId: "device-12345" });
    expect(result.driver.id).toBe("created");
    expect(mocks.application).toHaveBeenCalledOnce();
  });

  it("does not grant sessions for replayed or expired codes",async()=>{
    for(const record of [{consumedAt:new Date(),expiresAt:new Date(Date.now()+60000)},{consumedAt:null,expiresAt:new Date(0)}]){
      mocks.find.mockResolvedValue({...record,attempts:0});await expect(verifyChallenge({challengeId:"a".repeat(48),code:"123456",deviceId:"device-12345"})).rejects.toMatchObject({status:401});
    }
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does not attach an unlinked email to a phone account or bypass recruitment",async()=>{
    const id="a".repeat(48);mocks.find.mockResolvedValue({id,email:"new@example.com",channel:"email",phone:null,codeHash:challengeHash(id,"123456"),expiresAt:new Date(Date.now()+60000),consumedAt:null,attempts:0});mocks.driverFind.mockResolvedValue(null);
    await expect(verifyChallenge({challengeId:id,code:"123456",deviceId:"device-12345"})).rejects.toMatchObject({code:"REGISTRATION_PAUSED"});expect(mocks.driverCreate).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
  });
});
