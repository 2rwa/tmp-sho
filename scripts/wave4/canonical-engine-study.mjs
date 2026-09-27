
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const studyArg=process.argv.find(x=>x.startsWith('--study='));
const study=studyArg?studyArg.slice(8):null;
const htmlArg=process.argv.find(x=>x.startsWith('--engine-html='));
const htmlPath=path.resolve(htmlArg?htmlArg.slice(14):'/tmp/canonical/projects/sho-physical-synth/app/sho_physical_model_v0.html');
const outArg=process.argv.find(x=>x.startsWith('--out='));
const outDir=path.resolve(outArg?outArg.slice(6):'results-canonical');
fs.mkdirSync(outDir,{recursive:true});

const html=fs.readFileSync(htmlPath,'utf8');
const startToken='const ENGINE_CORE = String.raw\`';
const endToken='\`;\n\nlet audioContext';
const start=html.indexOf(startToken);
const end=html.indexOf(endToken,start+startToken.length);
if(start<0||end<0) throw new Error('ENGINE_CORE block not found');
const engineCore=html.slice(start+startToken.length,end);
const ShoPhysicalEngine=new Function(engineCore+'\nreturn ShoPhysicalEngine;')();

const NOTES=[
 ['乞',430.0],['一',483.75],['工',544.21875],['凢',573.3333333],['乙',645.0],
 ['下',725.625],['十',765.3076172],['美',816.328125],['行',860.0],['七',967.5],
 ['比',1020.4101563],['言',1088.4375],['上',1147.9614258],['八',1290.0],['千',1451.25]
];

function autocorr(signal,fs,minHz,maxHz){
  if(signal.length<1000)return {hz:null,corr:0};
  let mean=0;for(const x of signal)mean+=x;mean/=signal.length;
  const minLag=Math.floor(fs/maxHz),maxLag=Math.ceil(fs/minHz);
  let bestLag=0,bestCorr=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){
    let xy=0,xx=0,yy=0;
    for(let i=lag;i<signal.length;i++){
      const a=signal[i]-mean,b=signal[i-lag]-mean;
      xy+=a*b;xx+=a*a;yy+=b*b;
    }
    const c=xy/Math.sqrt(Math.max(xx*yy,1e-30));
    if(c>bestCorr){bestCorr=c;bestLag=lag;}
  }
  return {hz:bestLag?fs/bestLag:null,corr:Number.isFinite(bestCorr)?bestCorr:0};
}

function renderSignal({note,direction,pressure,sampleRate,totalSeconds}){
  const engine=new ShoPhysicalEngine(sampleRate);
  engine.setPaperMode(true);
  engine.setParams({
    pressure,direction,reedQ:12,massRate:0.30,drawEscapeScale:2.25,
    drawContractionRatio:1.50,reflection:0.985,pipeScale:1.0,reedCents:0,
    transitionMs:30,master:0.28
  });
  engine.setActiveNames([note]);
  const total=Math.floor(sampleRate*totalSeconds);
  const signal=new Float64Array(total);
  let pos=0;
  while(pos<total){
    const n=Math.min(512,total-pos);
    const block=new Float64Array(n);
    engine.render(block);
    signal.set(block,pos);pos+=n;
  }
  return signal;
}

function metric(signal,fs,duration,window,noteFreq){
  const end=Math.min(signal.length,Math.floor(fs*duration));
  const start=Math.max(0,end-Math.floor(fs*window));
  const view=signal.subarray(start,end);
  let ss=0,finite=true,peak=0;
  for(const v of view){if(!Number.isFinite(v))finite=false;ss+=v*v;peak=Math.max(peak,Math.abs(v));}
  const rms=Math.sqrt(ss/Math.max(1,view.length));
  const lo=noteFreq*(380/483.75),hi=noteFreq*(560/483.75);
  const f0=autocorr(view,fs,lo,hi);
  return {finite,rms,peak,f0_hz:f0.hz,corr:f0.corr};
}

function write(payload){
  const obj={schema:'sho-wave4-canonical-study-v1',study,canonical_commit:process.env.CANONICAL_COMMIT||null,generated_at:new Date().toISOString(),payload};
  fs.writeFileSync(path.join(outDir,'study.json'),JSON.stringify(obj,null,2)+'\n');
  process.stdout.write(JSON.stringify({study,summary:Array.isArray(payload)?payload.slice(0,10):payload},null,2)+'\n');
}

function range(start,stop,step){const a=[];for(let x=start;x<=stop+1e-9;x+=step)a.push(Number(x.toFixed(8)));return a;}

function runOnsetDetector(){
  const sampleRates=[24000,48000,96000];
  const durations=[1.5,2.0,3.0];
  const windows=[0.4,0.8,1.2];
  const rmsThresholds=[1e-6,1e-5,1e-4];
  const corrThresholds=[0.4,0.5,0.6];
  const pressureSets={
    blow:range(320,400,2),
    draw:range(70,110,1)
  };
  const metrics=[];
  for(const fsHz of sampleRates){
    for(const [dirName,direction] of [['blow',1],['draw',-1]]){
      for(const pressure of pressureSets[dirName]){
        process.stderr.write(\`render onset fs=\${fsHz} \${dirName} \${pressure}\n\`);
        const sig=renderSignal({note:'一',direction,pressure,sampleRate:fsHz,totalSeconds:3.0});
        for(const duration of durations)for(const window of windows){
          if(window>duration)continue;
          metrics.push({sample_rate_hz:fsHz,direction:dirName,pressure_pa:pressure,duration_s:duration,window_s:window,...metric(sig,fsHz,duration,window,483.75)});
        }
      }
    }
  }
  const thresholds=[];
  for(const fsHz of sampleRates)for(const duration of durations)for(const window of windows){
    if(window>duration)continue;
    for(const rmsThreshold of rmsThresholds)for(const corrThreshold of corrThresholds)for(const dirName of ['blow','draw']){
      const rows=metrics.filter(x=>x.sample_rate_hz===fsHz&&x.duration_s===duration&&x.window_s===window&&x.direction===dirName);
      const hit=rows.find(x=>x.finite&&x.rms>rmsThreshold&&x.corr>corrThreshold);
      thresholds.push({sample_rate_hz:fsHz,duration_s:duration,window_s:window,rms_threshold:rmsThreshold,corr_threshold:corrThreshold,direction:dirName,first_detected_pa:hit?.pressure_pa??null});
    }
  }
  return {
    canonical_detector:{sample_rate_hz:48000,duration_s:2.0,window_s:0.8,rms_threshold:1e-5,corr_threshold:0.5},
    canonical_results:{
      blow:thresholds.find(x=>x.sample_rate_hz===48000&&x.duration_s===2&&x.window_s===0.8&&x.rms_threshold===1e-5&&x.corr_threshold===0.5&&x.direction==='blow')?.first_detected_pa??null,
      draw:thresholds.find(x=>x.sample_rate_hz===48000&&x.duration_s===2&&x.window_s===0.8&&x.rms_threshold===1e-5&&x.corr_threshold===0.5&&x.direction==='draw')?.first_detected_pa??null
    },
    thresholds,
    metrics
  };
}

function detectAt(note,freq,direction,pressure){
  const sig=renderSignal({note,direction,pressure,sampleRate:48000,totalSeconds:2.0});
  const m=metric(sig,48000,2.0,0.8,freq);
  return {...m,pressure_pa:pressure,oscillating:m.finite&&m.rms>1e-5&&m.f0_hz!==null&&m.corr>0.5};
}

function findThreshold(note,freq,direction){
  const coarse=direction>0?range(200,600,20):range(40,180,10);
  let first=null,prev=null;
  const tested=[];
  for(const p of coarse){
    const x=detectAt(note,freq,direction,p);tested.push(x);
    if(x.oscillating){first=p;break;}prev=p;
  }
  if(first===null)return {threshold_pa:null,tested};
  const step=direction>0?2:1;
  const refineStart=Math.max(direction>0?0:0,prev??Math.max(0,first-(direction>0?20:10)));
  for(const p of range(refineStart,first,step)){
    if(tested.some(x=>x.pressure_pa===p))continue;
    const x=detectAt(note,freq,direction,p);tested.push(x);
  }
  tested.sort((a,b)=>a.pressure_pa-b.pressure_pa);
  const hit=tested.find(x=>x.oscillating);
  return {threshold_pa:hit?.pressure_pa??null,onset:hit??null,tested};
}

function runPipeCensus(){
  const rows=[];
  for(const [note,freq] of NOTES){
    process.stderr.write(\`canonical census \${note}\n\`);
    rows.push({note,reference_freq_hz:freq,blow:findThreshold(note,freq,1),draw:findThreshold(note,freq,-1)});
  }
  return rows;
}

if(study==='onset-detector') write(runOnsetDetector());
else if(study==='pipe-census') write(runPipeCensus());
else throw new Error('unknown study '+study);
