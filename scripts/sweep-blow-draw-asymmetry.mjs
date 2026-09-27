#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sampleRate = 48000;
const SOURCE_COMMIT = '40b1338e071e1e8bc0c9a03d9af4c0d394e7c06e';
const SOURCE_HTML_BLOB = 'a978df0b0bb8f4c2a4cf2f93439c826dd6c75800';
const TARGET = { blow: 370, draw: 90 };
const quickMode = process.argv.includes('--quick');

class ShoPipeModel {
  constructor(sampleRateValue) {
    this.fs = sampleRateValue;
    this.airDensity = 1.2;
    this.soundSpeed = 340.0;
    this.reedWidth = 0.002;
    this.reedLength = 0.010;
    this.reedThickness = 0.0003;
    this.reedDensity = 8000.0;
    this.clearance = 0.00001;
    this.flowContraction = 0.61;
    this.pipeRadius = 0.0035;
    this.characteristicImpedance = this.airDensity * this.soundSpeed / (Math.PI * this.pipeRadius * this.pipeRadius);
    this.referencePipeLength = 0.241;
    this.tipDisplacement = 0.0;
    this.tipVelocity = 0.0;
    this.returnState = 0.0;
    this.previousWave = 0.0;
    this.dcBlockState = 0.0;
    this.gate = 0.0;
    this.gateTarget = 1.0;
    this.delayBuffer = new Float64Array(512);
    this.writeIndex = 0;
  }

  renderOne(sourcePressure, params) {
    const dt = 1.0 / this.fs;
    const transitionSeconds = Math.max(0.015, params.transitionMs * 0.001);
    const gateCoefficient = 1.0 - Math.exp(-dt / transitionSeconds);
    this.gate += (this.gateTarget - this.gate) * gateCoefficient;

    const reedFrequency = 470.0;
    const reedOmega = 2.0 * Math.PI * reedFrequency;
    const baseMass = this.reedDensity * this.reedWidth * this.reedLength * this.reedThickness * (1.0 + params.massRate);
    const effectiveMass = baseMass * Math.pow(470.0 / reedFrequency, 2.0);

    const pipeLength = this.referencePipeLength * params.pipeScale;
    const delaySamples = Math.max(2.0, 2.0 * pipeLength / this.soundSpeed * this.fs);
    const bufferLength = this.delayBuffer.length;
    let readPosition = this.writeIndex - delaySamples;
    while (readPosition < 0.0) readPosition += bufferLength;
    const readIndex0 = Math.floor(readPosition) % bufferLength;
    const readFraction = readPosition - Math.floor(readPosition);
    const readIndex1 = (readIndex0 + 1) % bufferLength;
    const delayedWave = this.delayBuffer[readIndex0] * (1.0 - readFraction) + this.delayBuffer[readIndex1] * readFraction;

    const effectiveReflection = 0.025 + this.gate * (params.reflection - 0.025);
    const reflectedTarget = -effectiveReflection * delayedWave;
    this.returnState += 0.62 * (reflectedTarget - this.returnState);
    const returnedPressure = this.returnState;

    // Minimal geometric asymmetry candidate. The 2003 shō paper states that
    // the real reed back is slightly chiseled and that the reed leaves the slot
    // more easily while drawing. Preserve the rest clearance, but let signed
    // displacement change aperture faster on the draw-favoured side.
    const escapeScale = this.tipDisplacement < 0.0 ? params.drawEscapeScale : 1.0;
    const apertureDisplacement = this.tipDisplacement * escapeScale;
    const sideAverage = 0.4 * Math.abs(apertureDisplacement);
    const openingArea = this.reedWidth * Math.sqrt(apertureDisplacement * apertureDisplacement + this.clearance * this.clearance)
      + 2.0 * this.reedLength * Math.sqrt(sideAverage * sideAverage + this.clearance * this.clearance);
    const pumpedFlow = 0.4 * this.reedWidth * this.reedLength * this.tipVelocity;

    let pipeEntrancePressure = returnedPressure;
    let flowVelocity = 0.0;
    for (let iteration = 0; iteration < 4; iteration++) {
      const pressureDifference = sourcePressure - pipeEntrancePressure;
      const absolutePressure = Math.max(Math.abs(pressureDifference), 1.0e-5);
      const pressureSign = pressureDifference >= 0.0 ? 1.0 : -1.0;
      const contraction = this.flowContraction * (pressureSign < 0 ? params.drawContractionRatio : 1.0);
      const flowFactor = contraction * openingArea * Math.sqrt(2.0 / this.airDensity);
      flowVelocity = flowFactor * pressureSign * Math.sqrt(absolutePressure);
      const residual = pipeEntrancePressure - returnedPressure - this.characteristicImpedance * (flowVelocity + pumpedFlow);
      const derivative = 1.0 + this.characteristicImpedance * flowFactor * 0.5 / Math.sqrt(absolutePressure);
      pipeEntrancePressure -= residual / derivative;
    }

    const finalDifference = sourcePressure - pipeEntrancePressure;
    const finalSign = finalDifference >= 0.0 ? 1.0 : -1.0;
    const finalContraction = this.flowContraction * (finalSign < 0 ? params.drawContractionRatio : 1.0);
    const finalFlowFactor = finalContraction * openingArea * Math.sqrt(2.0 / this.airDensity);
    flowVelocity = finalFlowFactor * finalSign * Math.sqrt(Math.max(Math.abs(finalDifference), 0.0));

    const pressureForce = (1.5 * this.reedWidth * this.reedLength / effectiveMass) * (sourcePressure - pipeEntrancePressure);
    const dampingForce = (reedOmega / params.reedQ) * this.tipVelocity;
    const restoringForce = reedOmega * reedOmega * this.tipDisplacement;
    const tipAcceleration = pressureForce - dampingForce - restoringForce;
    this.tipVelocity += tipAcceleration * dt;
    this.tipDisplacement += this.tipVelocity * dt;

    if (!Number.isFinite(this.tipDisplacement) || Math.abs(this.tipDisplacement) > 0.0025) {
      this.tipDisplacement = Math.max(-0.0025, Math.min(0.0025, Number.isFinite(this.tipDisplacement) ? this.tipDisplacement : 0.0));
      this.tipVelocity *= 0.15;
    }

    const netInputFlow = flowVelocity + 0.4 * this.reedWidth * this.reedLength * this.tipVelocity;
    const outgoingWave = pipeEntrancePressure + this.characteristicImpedance * netInputFlow;
    this.delayBuffer[this.writeIndex] = outgoingWave;
    this.writeIndex = (this.writeIndex + 1) % bufferLength;

    const acWave = outgoingWave - this.previousWave + 0.995 * this.dcBlockState;
    this.previousWave = outgoingWave;
    this.dcBlockState = acWave;
    return acWave * this.gate;
  }
}

class ShoSinglePipeEngine {
  constructor(fs) {
    this.fs = fs;
    this.pipe = new ShoPipeModel(fs);
    this.pressureState = 0.0;
    this.lowpass1 = 0.0;
    this.lowpass2 = 0.0;
  }

  render(output, params) {
    const pressureTarget = params.direction * params.pressure;
    const pressureCoefficient = 1.0 - Math.exp(-1.0 / (this.fs * 0.060));
    const cutoff = 12000.0;
    const lowpassCoefficient = 1.0 - Math.exp(-2.0 * Math.PI * cutoff / this.fs);
    for (let i = 0; i < output.length; i++) {
      this.pressureState += (pressureTarget - this.pressureState) * pressureCoefficient;
      let mixedPressure = this.pipe.renderOne(this.pressureState, params) * 0.00062;
      this.lowpass1 += lowpassCoefficient * (mixedPressure - this.lowpass1);
      this.lowpass2 += lowpassCoefficient * (this.lowpass1 - this.lowpass2);
      output[i] = Math.tanh(this.lowpass2 * params.master);
    }
  }
}

function autocorrelationF0(signal, fs) {
  let mean = 0;
  for (const x of signal) mean += x;
  mean /= Math.max(signal.length, 1);
  const minLag = Math.floor(fs / 560);
  const maxLag = Math.ceil(fs / 380);
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = lag; i < signal.length; i++) {
      const a = signal[i] - mean;
      const b = signal[i - lag] - mean;
      xy += a * b; xx += a * a; yy += b * b;
    }
    const corr = xy / Math.sqrt(Math.max(xx * yy, 1e-30));
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return { hz: bestLag ? fs / bestLag : null, corr: Number.isFinite(bestCorr) ? bestCorr : 0 };
}

function renderCase(direction, pressure, asym) {
  const engine = new ShoSinglePipeEngine(sampleRate);
  const params = {
    pressure,
    direction,
    reedQ: asym.reedQ,
    massRate: asym.massRate,
    reflection: 0.985,
    pipeScale: 1.0,
    transitionMs: 30,
    master: 0.28,
    drawEscapeScale: asym.drawEscapeScale,
    drawContractionRatio: asym.drawContractionRatio
  };
  const totalSamples = sampleRate * 2;
  const collectStart = Math.floor(sampleRate * 1.2);
  const collected = [];
  let peak = 0;
  let finite = true;
  for (let globalIndex = 0; globalIndex < totalSamples;) {
    const n = Math.min(512, totalSamples - globalIndex);
    const block = new Float64Array(n);
    engine.render(block, params);
    for (let i = 0; i < n; i++) {
      const v = block[i];
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
      if (globalIndex + i >= collectStart) collected.push(v);
    }
    globalIndex += n;
  }
  let sumsq = 0;
  for (const v of collected) sumsq += v * v;
  const rms = Math.sqrt(sumsq / Math.max(collected.length, 1));
  const f0 = autocorrelationF0(collected, sampleRate);
  return {
    direction: direction > 0 ? 'blow' : 'draw',
    pressure_pa: pressure,
    finite,
    peak,
    rms,
    estimated_f0_hz: f0.hz,
    autocorr: f0.corr,
    oscillating: finite && rms > 1e-5 && f0.hz !== null && f0.corr > 0.5
  };
}

function estimateThreshold(direction, asym) {
  const coarseStep = 30;
  const maxPressure = 600;
  let prev = 0;
  let hit = null;
  const probes = [];
  for (let p = coarseStep; p <= maxPressure; p += coarseStep) {
    const r = renderCase(direction, p, asym);
    probes.push(r);
    if (r.oscillating) { hit = p; break; }
    prev = p;
  }
  if (hit === null) return { threshold_pa: null, onset: null, probes };
  let refined = hit;
  let onset = probes[probes.length - 1];
  for (let p = prev + 5; p < hit; p += 5) {
    const r = renderCase(direction, p, asym);
    probes.push(r);
    if (r.oscillating) { refined = p; onset = r; break; }
  }
  return { threshold_pa: refined, onset, probes };
}

const variants = [];
function familyFor(drawEscapeScale, drawContractionRatio) {
  if (drawEscapeScale === 1.0 && drawContractionRatio === 1.0) return 'symmetric';
  if (drawEscapeScale !== 1.0 && drawContractionRatio === 1.0) return 'geometry';
  if (drawEscapeScale === 1.0 && drawContractionRatio !== 1.0) return 'flow';
  return 'combined';
}
function addVariant(reedQ, massRate, drawEscapeScale, drawContractionRatio) {
  const family = familyFor(drawEscapeScale, drawContractionRatio);
  variants.push({
    id: `q${reedQ.toFixed(1)}-m${massRate.toFixed(2)}-${family}-e${drawEscapeScale.toFixed(2)}-c${drawContractionRatio.toFixed(2)}`,
    family,
    reedQ,
    massRate,
    drawEscapeScale,
    drawContractionRatio
  });
}
if (quickMode) {
  addVariant(20, 0.15, 1.0, 1.0);
  for (const e of [1.25, 1.5, 2.0]) addVariant(20, 0.15, e, 1.0);
  for (const c of [1.25, 1.5]) addVariant(20, 0.15, 1.0, c);
  for (const e of [1.5, 2.0]) for (const c of [1.25, 1.5]) addVariant(20, 0.15, e, c);
} else {
  for (const q of [8, 10, 12, 15, 20]) {
    for (const m of [0.0, 0.15, 0.30]) {
      for (const e of [1.0, 1.25, 1.5, 2.0]) {
        for (const c of [1.0, 1.25, 1.5]) addVariant(q, m, e, c);
      }
    }
  }
}

const results = [];
for (const variant of variants) {
  process.stderr.write(`variant ${variant.id}\n`);
  const blow = estimateThreshold(1, variant);
  const draw = estimateThreshold(-1, variant);
  const blowError = blow.threshold_pa === null ? 9999 : Math.abs(blow.threshold_pa - TARGET.blow);
  const drawError = draw.threshold_pa === null ? 9999 : Math.abs(draw.threshold_pa - TARGET.draw);
  results.push({
    ...variant,
    blow_threshold_pa: blow.threshold_pa,
    draw_threshold_pa: draw.threshold_pa,
    blow_onset_f0_hz: blow.onset?.estimated_f0_hz ?? null,
    draw_onset_f0_hz: draw.onset?.estimated_f0_hz ?? null,
    blow_error_pa: blowError,
    draw_error_pa: drawError,
    total_abs_error_pa: blowError + drawError,
    probes: { blow: blow.probes, draw: draw.probes }
  });
}

const baseline = results.find(x => x.reedQ === 20 && x.massRate === 0.15 && x.drawEscapeScale === 1.0 && x.drawContractionRatio === 1.0);
if (!baseline || baseline.blow_threshold_pa !== baseline.draw_threshold_pa) {
  throw new Error(`baseline symmetry regression failed: ${JSON.stringify(baseline)}`);
}
if (baseline.blow_threshold_pa === null || baseline.blow_threshold_pa <= 200 || baseline.blow_threshold_pa > 300) {
  throw new Error(`baseline onset no longer brackets the canonical coarse regression (200 Pa off, 300 Pa on): ${baseline?.blow_threshold_pa}`);
}

const ranked = [...results].sort((a, b) => a.total_abs_error_pa - b.total_abs_error_pa);
const outDirArg = process.argv.find(x => x.startsWith('--out='));
const outDir = path.resolve(outDirArg ? outDirArg.slice(6) : 'results');
fs.mkdirSync(outDir, { recursive: true });

const summary = {
  schema: 'sho-blow-draw-asymmetry-sweep-v2',
  run_id: process.env.GITHUB_RUN_ID || null,
  compute_repo_commit: process.env.GITHUB_SHA || null,
  mode: quickMode ? 'quick' : 'full',
  task: 'blow-draw-asymmetry',
  source_commit: SOURCE_COMMIT,
  source_html_blob: SOURCE_HTML_BLOB,
  generated_at: new Date().toISOString(),
  input_description: 'Single ichi pipe, 48 kHz, 2 s renders, current v0.1 baseline plus two minimal asymmetry terms.',
  literature_basis: {
    doi: '10.1121/1.1534605',
    statement: 'Hikichi et al. report lower negative-pressure threshold, note small reed asymmetry and upstream/downstream configuration, and state that the reed back is slightly chiseled so it leaves the slot more easily while drawing.'
  },
  target_threshold_pa: TARGET,
  baseline_threshold_pa: { blow: baseline.blow_threshold_pa, draw: baseline.draw_threshold_pa },
  asymmetry_terms: {
    drawEscapeScale: 'Signed-displacement aperture scaling on the negative/displacement side. 1.0 reproduces the even F(x) baseline; >1 makes the reed leave the slot faster on the draw-favoured side without changing rest clearance.',
    drawContractionRatio: 'Multiplier on Bernoulli contraction coefficient C when instantaneous pressure difference is negative, representing upstream/downstream flow-configuration asymmetry.'
  },
  parameter_grid: quickMode ? 'quick preflight grid' : { reedQ:[8,10,12,15,20], massRate:[0,0.15,0.30], drawEscapeScale:[1,1.25,1.5,2], drawContractionRatio:[1,1.25,1.5] },
  threshold_search: '30 Pa coarse scan from 30..600 Pa; then 5 Pa refinement within the first oscillating bracket; same oscillation heuristic as canonical regression.',
  ranked: ranked.map(({probes, ...x}) => x)
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'full.json'), JSON.stringify({...summary, variants: results}, null, 2) + '\n');

const csvFields = ['id','family','reedQ','massRate','drawEscapeScale','drawContractionRatio','blow_threshold_pa','draw_threshold_pa','blow_onset_f0_hz','draw_onset_f0_hz','blow_error_pa','draw_error_pa','total_abs_error_pa'];
const csv = [csvFields.join(',')].concat(ranked.map(r => csvFields.map(k => r[k] ?? '').join(','))).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'summary.csv'), csv);

const rows = ranked.map(r => `<tr><td>${r.id}</td><td>${r.family}</td><td>${r.reedQ}</td><td>${r.massRate}</td><td>${r.drawEscapeScale}</td><td>${r.drawContractionRatio}</td><td>${r.blow_threshold_pa ?? '-'}</td><td>${r.draw_threshold_pa ?? '-'}</td><td>${r.blow_onset_f0_hz?.toFixed(1) ?? '-'}</td><td>${r.draw_onset_f0_hz?.toFixed(1) ?? '-'}</td><td>${r.total_abs_error_pa}</td></tr>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shō blow/draw asymmetry sweep</title><style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border-bottom:1px solid #ddd;padding:.45rem;text-align:right}th:first-child,td:first-child{text-align:left}code{background:#f3f3f3;padding:.1rem .3rem}</style></head><body><h1>Shō blow/draw asymmetry sweep</h1><p>Target: blow ~370 Pa, draw ~90 Pa. The canonical coarse regression first detects onset at 300 Pa; this sweep refines the 200–300 Pa bracket in 5 Pa steps.</p><p><code>drawEscapeScale</code> models the chiseled-reed geometric escape asymmetry; <code>drawContractionRatio</code> models upstream/downstream flow contraction asymmetry.</p><table><thead><tr><th>variant</th><th>family</th><th>Q</th><th>mass</th><th>escape</th><th>C ratio</th><th>blow Pa</th><th>draw Pa</th><th>blow f0</th><th>draw f0</th><th>|error| Pa</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);

process.stdout.write(JSON.stringify({baseline: summary.baseline_threshold_pa, top5: summary.ranked.slice(0,5)}, null, 2) + '\n');
