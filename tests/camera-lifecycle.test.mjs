import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the real component's camera functions with controlled device timing.
// No production login, database requests or physical camera are involved.
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(["releaseCameraStream", "startCamera", "stopCamera"].map(name=>functions.get(name)).join("\n"), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settle=()=>new Promise(r=>setImmediate(r));

class Track extends EventTarget {
  readyState="live";
  stop(){this.readyState="ended";}
  endFromDevice(){this.readyState="ended";this.dispatchEvent(new Event("ended"));}
}
class Stream {
  track=new Track();
  getTracks(){return [this.track];}
  getVideoTracks(){return [this.track];}
}
function harness({optimize, detector, decode, acquire, manualFrames=false}={}) {
  const streams=[],readers=[],registered=[],errors=[],frames=[],timers=[];
  const video={srcObject:null,isConnected:true,play:async()=>{}};
  const state={cameraOpen:false,status:""};
  const context={
    cameraSessionRef:{current:0},cameraStreamRef:{current:null},videoRef:{current:video},controlsRef:{current:null},
    lastScanRef:{current:{code:"",at:0}},MediaStream:Stream,DOMException,
    setCameraOpen:value=>{state.cameraOpen=value;},setCameraStatus:value=>{state.status=value;},
    navigator:{userAgent:"iPhone",mediaDevices:{getUserMedia:async()=>{
      const stream=acquire?await acquire():new Stream();streams.push(stream);return stream;
    }}},
    cameraConstraints:()=>({audio:false,video:{facingMode:{ideal:"environment"}}}),
    requestAnimationFrame:fn=>{if(manualFrames)frames.push(fn);else queueMicrotask(fn);return 1;},
    optimizeCamera:async(stream,element)=>{
      if(optimize)await optimize(stream,element);
      element.srcObject=stream;
      return {focus:true,width:1920,height:1080};
    },
    androidBarcodeDetector:detector??(async()=>null),
    scannerHints:()=>new Map(),DecodeHintType:{TRY_HARDER:"harder"},
    normalizeBarcode:x=>x,registerCode:(code,evaluation)=>registered.push({code,evaluation}),
    toast:{error:(...args)=>errors.push(args),info:(...args)=>errors.push(args)},
    Date,Promise,Set,console,
  };
  context.window={setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:id=>{timers[id-1]=null;},requestAnimationFrame:context.requestAnimationFrame};
  context.BrowserMultiFormatOneDReader=class {
    hints=new Map();
    async decodeFromStream(stream,element,callback){
      // ZXing releases its captured stream and clears its captured preview.
      const controls={stopped:false,stop(){this.stopped=true;stream.getTracks().forEach(t=>t.stop());element.srcObject=null;}};
      readers.push({stream,element,callback,controls});
      if(decode)await decode();
      return controls;
    }
  };
  vm.runInNewContext(code,context);
  return {context,state,streams,readers,registered,errors,video,frames,timers};
}

test("stop during optimization releases the device immediately and prevents a late reader",async()=>{
  const entered=deferred(),resume=deferred();
  const h=harness({optimize:async()=>{entered.resolve();await resume.promise;}});
  const starting=h.context.startCamera(true);
  await entered.promise;
  h.context.stopCamera();
  const stoppedImmediately=h.streams[0].track.readyState==="ended";
  resume.resolve();await starting;
  assert.equal(stoppedImmediately,true);
  assert.equal(h.readers.length,0);
  assert.equal(h.state.cameraOpen,false);
});

test("a canceled scanner cannot replace the newer evaluation reader",async()=>{
  const entered=deferred(),resume=deferred();let calls=0;
  const h=harness({detector:async()=>{if(calls++===0){entered.resolve();await resume.promise;}return null;}});
  const oldStart=h.context.startCamera(false);await entered.promise;
  h.context.stopCamera();h.context.videoRef.current={srcObject:null,isConnected:true};
  await h.context.startCamera(true);
  const current=h.context.controlsRef.current;
  resume.resolve();await oldStart;
  assert.equal(h.context.controlsRef.current,current);
  assert.equal(current.stopped,false);
  assert.equal(h.streams[0].track.readyState,"ended");
  assert.equal(h.streams[1].track.readyState,"live");
});

test("late decoder completion cannot restore controls after stop",async()=>{
  const entered=deferred(),resume=deferred();
  const h=harness({decode:async()=>{entered.resolve();await resume.promise;}});
  const starting=h.context.startCamera(true);await entered.promise;
  h.context.stopCamera();resume.resolve();await starting;
  assert.equal(h.context.controlsRef.current,null);
  assert.equal(h.readers[0].controls.stopped,true);
  assert.equal(h.streams[0].track.readyState,"ended");
});

test("a late decoder callback cannot register a product after changing section",async()=>{
  const h=harness();await h.context.startCamera(true);
  const reader=h.readers[0];
  reader.callback({getText:()=>"0012345678901"});
  h.context.stopCamera();reader.callback({getText:()=>"0098765432100"});
  assert.equal(h.registered.length,1);
  assert.equal(h.registered[0].evaluation,true);
});

test("device-ended video unlocks evaluation's activation button",async()=>{
  const h=harness();await h.context.startCamera(true);
  h.streams[0].track.endFromDevice();await settle();
  assert.equal(h.state.cameraOpen,false);
  assert.equal(h.context.controlsRef.current,null);
});

test("stop frees the camera even after React has detached the video",async()=>{
  const h=harness({detector:async()=>({detect:async()=>[]})});
  await h.context.startCamera(true);
  h.context.videoRef.current=null;
  h.context.stopCamera();
  assert.equal(h.streams[0].track.readyState,"ended");
});

test("late permission approval after cancellation is released without opening a reader",async()=>{
  const permission=deferred();const stream=new Stream();
  const h=harness({acquire:()=>permission.promise});
  const starting=h.context.startCamera(true);await settle();
  h.context.stopCamera();permission.resolve(stream);await starting;
  assert.equal(stream.track.readyState,"ended");
  assert.equal(h.readers.length,0);
});

test("a late decoder cannot clear the preview of a replacement session sharing the video",async()=>{
  const entered=deferred(),resume=deferred();let calls=0;
  const h=harness({decode:async()=>{if(calls++===0){entered.resolve();await resume.promise;}}});
  const oldStart=h.context.startCamera(false);await entered.promise;
  h.context.stopCamera();await h.context.startCamera(true);
  const current=h.context.controlsRef.current;
  resume.resolve();await oldStart;
  assert.equal(h.context.controlsRef.current,current);
  assert.equal(h.video.srcObject,h.streams[1]);
  assert.equal(h.streams[1].track.readyState,"live");
});

test("a rejected native fallback closes the camera and allows a retry",async()=>{
  const h=harness({manualFrames:true,detector:async()=>({detect:async()=>{throw new Error("native detector failed");}}),decode:async()=>{throw new Error("decoder unavailable");}});
  const starting=h.context.startCamera(true);
  h.frames.shift()();await starting;
  h.frames.shift()();await settle();
  h.timers.shift()();await settle();
  const closed=h.state.cameraOpen===false;
  h.context.stopCamera();
  assert.equal(closed,true);
  assert.equal(h.streams[0].track.readyState,"ended");
  assert.equal(h.errors[0][0],"No se pudo abrir la cámara");
});

test("normal scanner and evaluation stay continuous and retain their own registration source",async()=>{
  const h=harness();await h.context.startCamera(false);
  h.readers[0].callback({getText:()=>"0012345678901"});
  h.readers[0].callback({getText:()=>"0098765432100"});
  assert.equal(h.state.cameraOpen,true);
  h.context.stopCamera();await h.context.startCamera(true);
  h.readers[1].callback({getText:()=>"0088888888888"});
  assert.equal(h.state.cameraOpen,true);
  assert.deepEqual(h.registered.map(x=>x.evaluation),[false,false,true]);
  h.context.stopCamera();
});

test("a late native detection cannot register a product in the next section",async()=>{
  const entered=deferred(),result=deferred();
  const h=harness({detector:async()=>({detect:async()=>{entered.resolve();return result.promise;}})});
  await h.context.startCamera(true);await entered.promise;
  h.context.stopCamera();result.resolve([{rawValue:"0012345678901"}]);await settle();
  assert.equal(h.registered.length,0);
});

test("stopping before preview mount never requests camera permission",async()=>{
  const h=harness({manualFrames:true});const starting=h.context.startCamera(true);
  h.context.stopCamera();h.frames.shift()();await starting;
  assert.equal(h.streams.length,0);
  assert.equal(h.state.cameraOpen,false);
});

test("an old track ending cannot close a newly opened camera",async()=>{
  const h=harness();await h.context.startCamera(false);
  h.context.stopCamera();await h.context.startCamera(true);
  const current=h.context.controlsRef.current;
  h.streams[0].track.endFromDevice();await settle();
  assert.equal(h.state.cameraOpen,true);
  assert.equal(h.context.controlsRef.current,current);
  h.context.stopCamera();
});

test("permission rejection unlocks the button and keeps the existing helpful message",async()=>{
  const h=harness({acquire:async()=>{throw new DOMException("denied","NotAllowedError");}});
  await h.context.startCamera(true);
  assert.equal(h.state.cameraOpen,false);
  assert.equal(h.errors[0][0],"No se pudo abrir la cámara");
  assert.match(h.errors[0][1].description,/Permite el acceso/);
});
