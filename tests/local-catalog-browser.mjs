// Run against a local/preview build with every Supabase request intercepted.
// PLAYWRIGHT_PATH=/tmp/scancontrol-browser-tests/node_modules/playwright/index.mjs node tests/local-catalog-browser.mjs
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { utils, write } from "xlsx";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const url = process.env.SCANCONTROL_TEST_URL ?? "http://127.0.0.1:3100";
const userId = "00000000-0000-4000-8000-000000000011";
const storeA = "00000000-0000-4000-8000-000000000021";
const storeB = "00000000-0000-4000-8000-000000000022";
const barcode = "0012345678901";
const largeBarcode = "0012345678918";
const tokenPart = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now()/1000);
const session = { access_token:`${tokenPart({alg:"HS256",typ:"JWT"})}.${tokenPart({sub:userId,role:"authenticated",exp:now+3600,iat:now})}.dGVzdA`,
  refresh_token:"isolated-test",token_type:"bearer",expires_in:3600,expires_at:now+3600,
  user:{id:userId,aud:"authenticated",email:"isolated-test@example.invalid",app_metadata:{},user_metadata:{}} };
const excel = (name,amount=39.95) => {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([
    ["Artículo","Descripcion","Código barras","Color","Talla","Estilo","Monto a Pagar","Descuento %","Marca","Cat 1","Cantidad"],
    ["ART-01","Producto local",barcode,"Azul","36","Deportivo",amount,15,"Canaima","Zapatos",1],
    ["ART-01","Producto local",largeBarcode,"Azul","37","Deportivo",amount,15,"Canaima","Zapatos",1],
  ]),"Inventario");
  return {name,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:write(workbook,{type:"buffer",bookType:"xlsx"})};
};
const browser = await chromium.launch({headless:true,args:["--no-sandbox","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
await mkdir("outputs",{recursive:true});
let currentPage;
try {
  for (const mobile of [false,true]) {
    const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},
      isMobile:mobile,hasTouch:mobile,permissions:["camera"],
      userAgent:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36"});
    const requests=[];
    const errors=[];
    const evaluationItems=[];
    const activities=[];
    await context.addInitScript(({session})=>{
      localStorage.setItem("sb-wmewkfkriihwaxqpeecs-auth-token",JSON.stringify(session));
      window.__testBarcodes=[];
      // A controlled browser MediaStream exercises the existing camera pipeline
      // without requiring a physical camera in the test container.
      navigator.mediaDevices.getUserMedia=async constraints=>{
        window.__testCameraConstraints=constraints;
        const canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;
        const graphics=canvas.getContext("2d");
        setInterval(()=>{graphics.fillStyle="#fff";graphics.fillRect(0,0,1920,1080);},33);
        return canvas.captureStream(30);
      };
      window.BarcodeDetector=class {
        static async getSupportedFormats(){return ["ean_13"];}
        async detect(){const rawValue=window.__testBarcodes.shift();return rawValue?[{rawValue}]:[];}
      };
    },{session});
    await context.route("**/*.supabase.co/**",async route=>{
      const request=route.request();
      const parsed=new URL(request.url());
      const table=parsed.pathname.split("/").at(-1);
      const method=request.method();
      const body=request.postDataJSON();
      requests.push({table,method,body});
      const store=parsed.searchParams.get("store_id")?.replace("eq.","")??storeA;
      const single=request.headers().accept?.includes("vnd.pgrst.object");
      let data=[];
      if(table==="profiles") data=[{id:userId,full_name:"Prueba aislada",role:"supervisor",store_id:storeA,is_active:true,is_owner:false}];
      else if(table==="stores") data=[{id:storeA,name:"Tienda prueba A",slug:"prueba-a"},{id:storeB,name:"Tienda prueba B",slug:"prueba-b"}];
      else if(table==="app_runtime_settings") data=[{maintenance_enabled:false}];
      else if(table==="catalog_versions") data=store===storeA?[{id:"legacy",file_name:"anterior-compartido.xlsx",row_count:1,activated_at:new Date().toISOString()}]:[];
      else if(table==="products") data=store===storeA?[{id:"legacy-product",store_id:storeA,barcode,article:"LEGACY",description:"Anterior",color:"Azul",size:"36",style:"Deportivo",amount:99,discount_percent:0}]:[];
      else if(table==="evaluations") data=method==="POST"?[{id:"evaluation-test",...body}]:[];
      else if(table==="evaluation_items") {
        if(method==="POST") {const item={id:`item-${evaluationItems.length}`,scanned_at:new Date().toISOString(),...body};evaluationItems.push(item);data=[item];}
        else if(method==="PATCH") {const id=parsed.searchParams.get("id")?.replace("eq.","");Object.assign(evaluationItems.find(item=>item.id===id),body);}
        else data=evaluationItems;
      }
      else if(table==="scan_activity") {
        if(method==="POST")activities.push({id:`activity-${activities.length}`,created_at:new Date().toISOString(),...body});
        else if(method==="PATCH") {const id=parsed.searchParams.get("evaluation_item_id")?.replace("eq.","");for(const activity of activities)if(activity.evaluation_item_id===id)Object.assign(activity,body);}
      }
      else if(table==="daily_activity_rows") data=activities.map(activity=>({...activity,activity_at:activity.created_at,employee_id:userId,employee_name:"Prueba aislada",store_name:"Tienda prueba A"}));
      else if(table!=="active_transfer_files") { errors.push(`Unexpected API ${method} ${table}`); }
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(single?data[0]??null:data)});
    });
    const page=await context.newPage();
    currentPage=page;
    page.setDefaultTimeout(10000);
    page.on("pageerror",error=>errors.push(error.message));
    const nav=target=>page.locator(".mobile-bottom-nav").getByRole("button",{name:target,exact:true}).click();
    const scan=async(code=barcode,amount="$39.95")=>{
      await nav("Escanear");
      await page.getByPlaceholder("Ej. 9880007937124").fill(code);
      await page.getByRole("button",{name:"Verificar",exact:true}).click();
      await page.waitForFunction(value=>document.querySelector(".price-value strong")?.textContent===value,amount);
    };
    const upload=async(file)=>{
      await page.getByLabel("Seleccionar archivo Excel",{exact:true}).setInputFiles(file);
      await page.waitForFunction(name=>document.querySelector(".catalog-status h3")?.textContent===name,file.name);
      await page.locator(".upload-feedback-success").waitFor();
      assert.match(await page.locator(".catalog-status").innerText(),new RegExp(file.name.replace(/\./g,"\\.")));
    };
    await page.goto(url);
    await page.locator(".scanner-layout").waitFor();
    await scan(barcode,"$99.00"); // Preserves the pre-existing catalog until a local import succeeds.
    await nav("Inventario");
    await upload(excel("local.xlsx"));
    await scan();
    assert.equal(await page.locator(".discount-value strong").textContent(),"15%");
    await nav("Inventario");
    await page.getByLabel("Seleccionar archivo Excel",{exact:true}).setInputFiles({name:"invalido.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from("invalid")});
    await page.locator(".upload-feedback-error").waitFor();
    assert.match(await page.locator(".catalog-status").innerText(),/local.xlsx/);
    await scan();
    await page.reload();
    await page.locator(".scanner-layout").waitFor();
    await scan();
    await nav("Inventario");
    await page.evaluate(()=>{window.__originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException("Full","QuotaExceededError");};});
    await page.getByLabel("Seleccionar archivo Excel",{exact:true}).setInputFiles(excel("sin-espacio.xlsx",1));
    await page.locator(".upload-feedback-error").waitFor();
    assert.match(await page.locator(".upload-feedback-error").innerText(),/espacio suficiente en este dispositivo/);
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__originalPut;});
    await scan();
    await nav("Evaluación");
    await page.getByRole("switch",{name:"Validar talla menor en Evaluación"}).click();
    await page.getByRole("button",{name:"Escanear continuamente",exact:true}).click();
    await page.evaluate(code=>window.__testBarcodes.push(code),largeBarcode);
    await page.locator(".evaluation-size-gate").waitFor();
    await page.getByRole("button",{name:"Talla menor no exhibida",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector(".evaluation-size-gate"));
    assert.equal(await page.evaluate(()=>window.__testCameraConstraints.video.width.ideal),1920);
    assert.equal(evaluationItems[0].product_id,null);
    assert.equal(evaluationItems[0].barcode,largeBarcode);
    assert.equal(evaluationItems[0].expected_size,"36");
    assert.equal(evaluationItems[0].observation,"TALLA MENOR NO EXHIBIDA");
    assert.ok(activities.some(row=>row.product_id===null&&row.article==="ART-01"&&row.amount===39.95));
    await nav("Registro");
    await page.locator(".daily-summary-grid").waitFor();
    assert.ok(activities.some(row=>row.observation==="TALLA MENOR NO EXHIBIDA"));
    await nav("Inventario");
    if(await page.locator(".mobile-store-switcher select").isVisible())await page.locator(".mobile-store-switcher select").selectOption(storeB);
    else {await page.locator(".desktop-store-switcher").getByRole("combobox").click();await page.getByRole("option",{name:"Tienda prueba B",exact:true}).click();}
    await page.waitForFunction(()=>document.querySelector(".catalog-status h3")?.textContent==="No se ha cargado un archivo");
    await upload(excel("tienda-b.xlsx",49.95));
    if(await page.locator(".mobile-store-switcher select").isVisible())await page.locator(".mobile-store-switcher select").selectOption(storeA);
    else {await page.locator(".desktop-store-switcher").getByRole("combobox").click();await page.getByRole("option",{name:"Tienda prueba A",exact:true}).click();}
    await page.waitForFunction(()=>document.querySelector(".catalog-status h3")?.textContent==="local.xlsx");
    // Another window on this account/device receives the committed catalog.
    const peer=await context.newPage();
    peer.on("pageerror",error=>errors.push(error.message));
    await peer.goto(url);
    await peer.locator(".mobile-bottom-nav").getByRole("button",{name:"Inventario",exact:true}).click();
    await peer.waitForFunction(()=>document.querySelector(".catalog-status h3")?.textContent==="local.xlsx");
    await upload(excel("actualizado.xlsx",44.95));
    await peer.waitForFunction(()=>document.querySelector(".catalog-status h3")?.textContent==="actualizado.xlsx");
    await peer.locator(".mobile-bottom-nav").getByRole("button",{name:"Escanear",exact:true}).click();
    await peer.getByPlaceholder("Ej. 9880007937124").fill(barcode);
    await peer.getByRole("button",{name:"Verificar",exact:true}).click();
    await peer.waitForFunction(()=>document.querySelector(".price-value strong")?.textContent==="$44.95");
    await peer.close();
    await page.screenshot({path:`outputs/local-catalog-${mobile?"android":"desktop"}.png`,fullPage:true});
    assert.equal(requests.filter(row=>["products","catalog_versions","activate_catalog","discard_catalog","catalog_upload_preflight"].includes(row.table)&&row.method!=="GET").length,0);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"Android viewport":"desktop"}: import, price/discount, reload, invalid/quota rollback, controlled camera pipeline, minimum-size incident, cloud snapshots, store isolation and cross-window updates; 0 catalog writes to Supabase.`);
    await context.close();
  }
} catch(error) {
  if(currentPage){console.error(await currentPage.locator("body").innerText());await currentPage.screenshot({path:"outputs/local-catalog-browser-failure.png",fullPage:true});}
  throw error;
} finally {await browser.close();}
