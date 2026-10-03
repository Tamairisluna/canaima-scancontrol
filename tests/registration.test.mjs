import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType:"custom", configFile:false, root,
  resolve:{alias:{"@":root}}, server:{middlewareMode:true,hmr:false} });
after(() => vite.close());
const { loadRegistrationStores, registrationLoadMessage } = await vite.ssrLoadModule("/app/lib/registration.ts");
const stores = [{ id:"store-one", name:"Tienda Uno", slug:"uno", city:"Caracas" }];
const client = (answers) => {
  let calls = 0;
  return { get calls(){return calls;}, rpc(name){
    assert.equal(name,"registration_stores_by_city");
    return { async abortSignal(signal){
      assert.ok(signal instanceof AbortSignal);
      const answer = answers[Math.min(calls++,answers.length-1)];
      if(answer instanceof Error) throw answer;
      return answer;
    }};
  }};
};

test("loads city/store directory without a signed-in session", async()=>{
  const mock=client([{data:stores,error:null}]);
  assert.deepEqual(await loadRegistrationStores(mock), stores);
  assert.equal(mock.calls,1);
});
test("automatically recovers a transient error and a thrown network error",async()=>{
  for(const error of [{data:null,error:{message:"backend unavailable"}},new Error("fetch failed")]){
    const mock=client([error,{data:stores,error:null}]);
    assert.deepEqual(await loadRegistrationStores(mock),stores);
    assert.equal(mock.calls,2);
  }
});
test("stops after two attempts and never exposes provider or raw errors",async()=>{
  const mock=client([{data:null,error:{message:"Supabase statement timeout"}}]);
  await assert.rejects(()=>loadRegistrationStores(mock),e=>e.message===registrationLoadMessage&&!/supabase|timeout/i.test(e.message));
  assert.equal(mock.calls,2);
});
test("empty and malformed directories do not enable arbitrary store registration",async()=>{
  await assert.rejects(()=>loadRegistrationStores(client([{data:[],error:null}])),/No hay tiendas disponibles/);
  await assert.rejects(()=>loadRegistrationStores(client([{data:[{id:null,name:"X"}],error:null}])),e=>e.message===registrationLoadMessage);
});
test("directory client does not persist or refresh a device token; signup role stays server-controlled",async()=>{
  const source=await readFile(new URL("../app/lib/supabase.ts",import.meta.url),"utf8");
  const directory=source.split("export const getRegistrationDirectoryClient")[1];
  assert.match(directory,/storageKey: "scancontrol-registration-directory"/);
  assert.match(directory,/persistSession: false/);
  assert.match(directory,/autoRefreshToken: false/);
  assert.match(directory,/detectSessionInUrl: false/);
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(page,/registro por tienda todavía debe activarse en Supabase/);
  assert.match(page,/onClick=\{\(\)=>void loadSignupStores\(\)\}/);
  assert.match(page,/options:\{data:\{full_name:fullName,store_id:signupForm.storeId\}\}/);
  assert.match(page,/finally \{\s*setSignupBusy\(false\)/);
});
