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

    // Minimal geometric asymmetry candidate. The 2003 shÅ paper states that
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
    draw_error_pa: draw.error_pa,
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

const ranked = [...results].sort((a, b) => a.total_abs_error_pa - b.total_absöW'&÷%÷“°¦6öç7B÷WDF—$&rÒ&ö6W72æ&wbæf–æB‡‚Óâ‚ç7F'G5v—F‚‚rÒÖ÷WCÒr’“°¦6öç7B÷WDF—"ÒF‚ç&W6öÇfR†÷WDF—$&rò÷WDF—$&rç6Æ–6Rƒb’¢w&W7VÇG2r“°¦g2æÖ¶F—%7–æ2†÷WDF—"Â²&V7W'6—fS¢G'VRÒ“° ¦6öç7B7VÖÖ'’Ò°¢66†VÖ¢w6†òÖ&Æ÷rÖG&rÖ7–ÖÖWG'’×7vVW×c"rÀ¢'Våö–C¢&ö6W72æVçbät•D…T%õ%Tåô”BÇÂçVÆÂÀ¢6ö×WFU÷&Wõö6öÖÖ—C¢&ö6W72æVçbät•D…T%õ4„ÇÂçVÆÂÀ¢ÖöFS¢V–6´ÖöFRòwV–6²r¢vgVÆÂrÀ¢F6³¢v&Æ÷rÖG&rÖ7–ÖÖWG'’rÀ¢6÷W&6Uö6öÖÖ—C¢4õU$4Uô4ôÔÔ•BÀ¢6÷W&6Uö‡FÖÅö&Æö#¢4õU$4Uô…DÔÅô$Äô"À¢vVæW&FVEöC¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢–çWEöFW67&—F–öã¢u6–ævÆR–6†’—RÂC‚´‡¢Â"2&VæFW'2Â7W'&VçBcã&6VÆ–æRÇW2GvòÖ–æ–ÖÂ7–ÖÖWG'’FW&×2ârÀ¢Æ—FW&GW&Uö&6—3¢°¢Fö“¢sã#óãS3CcRrÀ¢7FFVÖVçC¢t†–¶–6†’WBÂâ&W÷'BÆ÷vW"æVvF—fR×&W77W&RF‡&W6†öÆBÂæ÷FR6ÖÆÂ&VVB7–ÖÖWG'’æBW7G&VÒöF÷vç7G&VÒ6öæf–wW&F–öâÂæB7FFRF†BF†R&VVB&6²—26Æ–v‡FÇ’6†—6VÆVB6ò—BÆVfW2F†R6Æ÷BÖ÷&RV6–Ç’v†–ÆRG&v–ærâp¢ÒÀ¢F&vWE÷F‡&W6†öÆE÷¢D$tUBÀ¢&6VÆ–æU÷F‡&W6†öÆE÷¢²&Æ÷s¢&6VÆ–æRæ&Æ÷u÷F‡&W6†öÆE÷ÂG&s¢&6VÆ–æRæG&u÷F‡&W6†öÆE÷ÒÀ¢7–ÖÖWG'•÷FW&×3¢°¢G&tW66U66ÆS¢u6–væVBÖF—7Æ6VÖVçBW'GW&R66Æ–æröâF†RæVvF—fRöF—7Æ6VÖVçB6–FRâã&W&öGV6W2F†RWfVâb‡‚’&6VÆ–æS²ãÖ¶W2F†R&VVBÆVfRF†R6Æ÷Bf7FW"öâF†RG&rÖff÷W&VB6–FRv—F†÷WB6†æv–ær&W7B6ÆV&æ6RârÀ¢G&t6öçG&7F–öå&F–ó¢t×VÇF—Æ–W"öâ&W&æ÷VÆÆ’6öçG&7F–öâ6öVff–6–VçB2v†Vâ–ç7FçFæV÷W2&W77W&RF–ffW&Væ6R—2æVvF—fRÂ&W&W6VçF–ærW7G&VÒöF÷vç7G&VÒfÆ÷rÖ6öæf–wW&F–öâ7–ÖÖWG'’âp¢ÒÀ¢&ÖWFW%öw&–C¢V–6´ÖöFRòwV–6²&VfÆ–v‡Bw&–Br¢²&VVE¥³‚ÃÃ"ÃRÃ#ÒÂÖ75&FS¥³ÃãRÃã3ÒÂG&tW66U66ÆS¥³Ãã#RÃãRÃ%ÒÂG&t6öçG&7F–öå&F–ó¥³Ãã#RÃãUÒÒÀ¢F‡&W6†öÆE÷6V&6ƒ¢s36ö'6R66âg&öÒ3âãc²F†VâR&Vf–æVÖVçBv—F†–âF†Rf—'7B÷66–ÆÆF–ær'&6¶WC²6ÖR÷66–ÆÆF–öâ†WW&—7F–226æöæ–6Â&Vw&W76–öâârÀ¢&æ¶VC¢&æ¶VBæÖ‚‡·&ö&W2Âââç‡Ò’Óâ‚§Ó°¦g2çw&—FTf–ÆU7–æ2‡F‚æ¦ö–â†÷WDF—"Âw7VÖÖ'’æ§6öâr’Â¥4ôâç7G&–æv–g’‡7VÖÖ'’ÂçVÆÂÂ"’²uÆâr“°¦g2çw&—FTf–ÆU7–æ2‡F‚æ¦ö–â†÷WDF—"ÂvgVÆÂæ§6öâr’Â¥4ôâç7G&–æv–g’‡²ââç7VÖÖ'’Âf&–çG3¢&W7VÇG7ÒÂçVÆÂÂ"’²uÆâr“° ¦6öç7B77df–VÆG2Ò²v–BrÂvfÖ–Ç’rÂw&VVErÂvÖ75&FRrÂvG&tW66U66ÆRrÂvG&t6öçG&7F–öå&F–òrÂv&Æ÷u÷F‡&W6†öÆE÷rÂvG&u÷F‡&W6†öÆE÷rÂv&Æ÷uööç6WEöcö‡¢rÂvG&uööç6WEöcö‡¢rÂv&Æ÷uöW'&÷%÷rÂvG&uöW'&÷%÷rÂwF÷FÅö'5öW'&÷%÷uÓ°¦6öç7B77bÒ¶77df–VÆG2æ¦ö–â‚rÂr•Òæ6öæ6B‡&æ¶VBæÖ‡"Óâ77df–VÆG2æÖ†²Óâ%¶µÒóòrr’æ¦ö–â‚rÂr’’’æ¦ö–â‚uÆâr’²uÆâs°¦g2çw&—FTf–ÆU7–æ2‡F‚æ¦ö–â†÷WDF—"Âw7VÖÖ'’æ77br’Â77b“° ¦6öç7B&÷w2Ò&æ¶VBæÖ‡"ÓâÇG#ãÇFCâG·"æ–GÓÂ÷FCãÇFCâG·"æfÖ–Ç—ÓÂ÷FCãÇFCâG·"ç&VVEÓÂ÷FCãÇFCâG·"æÖ75&FWÓÂ÷FCãÇFCâG·"æG&tW66U66ÆWÓÂ÷FCãÇFCâG·"æG&t6öçG&7F–öå&F–÷ÓÂ÷FCãÇFCâG·"æ&Æ÷u÷F‡&W6†öÆE÷óòrÒwÓÂ÷FCãÇFCâG·"æG&u÷F‡&W6†öÆE÷óòrÒwÓÂ÷FCãÇFCâG·"æ&Æ÷uööç6WEöcö‡£òçFôf—†VBƒ’óòrÒwÓÂ÷FCãÇFCâG·"æG&uööç6WEöcö‡£òçFôf—†VBƒ’óòrÒwÓÂ÷FCãÇFCâG·"çF÷FÅö'5öW'&÷%÷ÓÂ÷FCãÂ÷G#æ’æ¦ö–â‚rr“°¦6öç7B‡FÖÂÒÂFö7G—R‡FÖÃãÆ‡FÖÃãÆ†VCãÆÖWF6†'6WCÒ'WFbÓ‚#ãÆÖWFæÖSÒ'f–Ww÷'B"6öçFVçCÒ'v–GFƒÖFWf–6R×v–GF‚Æ–æ—F–Â×66ÆSÓ#ãÇF—FÆSå6ŒXÒ&Æ÷röG&r7–ÖÖWG'’7vVWÂ÷F—FÆSãÇ7G–ÆSæ&öG—¶föçBÖfÖ–Ç“§7—7FVÒ×V’Ç6ç2×6W&–c¶Ö‚×v–GFƒ£ƒ¶Ö&v–ã£'&VÒWFó·FF–æs£&V××F&ÆW¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S·v–GFƒ£S¶föçB×6—¦S¢ã—&V××F‚ÇFG¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6FFC·FF–æs¢ãCW&VÓ·FW‡BÖÆ–vã§&–v‡G×Fƒ¦f—'7BÖ6†–ÆBÇFC¦f—'7BÖ6†–ÆG·FW‡BÖÆ–vã¦ÆVgGÖ6öFW¶&6¶w&÷VæC¢6c6c6c3·FF–æs¢ã&VÒã7&V×ÓÂ÷7G–ÆSãÂö†VCãÆ&öG“ãÆƒå6ŒXÒ&Æ÷röG&r7–ÖÖWG'’7vVWÂöƒãÇåF&vWC¢&Æ÷rã3sÂG&rã“âF†R6æöæ–6Â6ö'6R&Vw&W76–öâf—'7BFWFV7G2öç6WBB3²F†—27vVW&Vf–æW2F†R#(	33'&6¶WB–âR7FW2ãÂ÷ãÇãÆ6öFSæG&tW66U66ÆSÂö6öFSâÖöFVÇ2F†R6†—6VÆVB×&VVBvVöÖWG&–2W66R7–ÖÖWG'“²Æ6öFSæG&t6öçG&7F–öå&F–óÂö6öFSâÖöFVÇ2W7G&VÒöF÷vç7G&VÒfÆ÷r6öçG&7F–öâ7–ÖÖWG'’ãÂ÷ãÇF&ÆSãÇF†VCãÇG#ãÇFƒçf&–çCÂ÷FƒãÇFƒæfÖ–Ç“Â÷FƒãÇFƒåÂ÷FƒãÇFƒæÖ73Â÷FƒãÇFƒæW66SÂ÷FƒãÇFƒä2&F–óÂ÷FƒãÇFƒæ&Æ÷rÂ÷FƒãÇFƒæG&rÂ÷FƒãÇFƒæ&Æ÷rcÂ÷FƒãÇFƒæG&rcÂ÷FƒãÇFƒçÆW'&÷'ÂÂ÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âG·&÷w7ÓÂ÷F&öG“ãÂ÷F&ÆSãÂö&öG“ãÂö‡FÖÃæ°¦g2çw&—FTf–ÆU7–æ2‡F‚æ¦ö–â†÷WDF—"Âv–æFW‚æ‡FÖÂr’Â‡FÖÂ“° §&ö6W72ç7FF÷WBçw&—FR„¥4ôâç7G&–æv–g’‡¶&6VÆ–æS¢7VÖÖ'’æ&6VÆ–æU÷F‡&W6†öÆE÷ÂF÷S¢7VÖÖ'’ç&æ¶VBç6Æ–6RƒÃR—ÒÂçVÆÂÂ"’²uÆâr“°