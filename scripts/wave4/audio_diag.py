
import argparse, json, math, os, wave
from pathlib import Path
import numpy as np

ap=argparse.ArgumentParser()
ap.add_argument("--input",required=True)
ap.add_argument("--out",required=True)
args=ap.parse_args()
root=Path(args.input); out=Path(args.out); out.mkdir(parents=True,exist_ok=True)

def read_wav(p):
    with wave.open(str(p),"rb") as w:
        sr=w.getframerate(); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth()
        raw=w.readframes(n)
    if sw!=2: raise RuntimeError(f"expected 16-bit PCM: {p}")
    x=np.frombuffer(raw,dtype="<i2").astype(np.float64)/32768.0
    if ch>1:x=x.reshape(-1,ch).mean(axis=1)
    return sr,x

def spectrum_metrics(sr,x):
    if len(x)>sr*4:x=x[-sr*4:]
    win=np.hanning(len(x))
    y=np.fft.rfft(x*win)
    mag=np.abs(y)+1e-20
    freqs=np.fft.rfftfreq(len(x),1/sr)
    power=mag**2
    sel=(freqs>=50)&(freqs<=4000)
    centroid=float((freqs[sel]*power[sel]).sum()/max(power[sel].sum(),1e-30))
    band=(freqs>=50)&(freqs<=3000)
    peak_idx=np.where(band)[0][np.argmax(mag[band])]
    f0=float(freqs[peak_idx])
    db=20*np.log10(mag/mag.max())
    floor=float(np.median(db[(freqs>=100)&(freqs<=8000)]))
    # local peaks, simple NMS
    candidates=[]
    for i in range(2,len(mag)-2):
        if 50<=freqs[i]<=8000 and mag[i]>=mag[i-1] and mag[i]>=mag[i+1]:
            candidates.append((mag[i],float(freqs[i]),float(db[i])))
    candidates.sort(reverse=True)
    top=[]
    for m,f,d in candidates:
        if all(abs(f-q["hz"])>5 for q in top):
            top.append({"hz":f,"db_rel":d})
        if len(top)>=20:break
    return {"dominant_hz":f0,"spectral_centroid_hz":centroid,"median_floor_db_rel":floor,"top_peaks":top}

def stft_summary(sr,x):
    nfft=4096; hop=1024
    rows=[]
    for start in range(0,max(1,len(x)-nfft+1),hop):
        frame=x[start:start+nfft]
        if len(frame)<nfft:break
        mag=np.abs(np.fft.rfft(frame*np.hanning(nfft)))+1e-20
        freqs=np.fft.rfftfreq(nfft,1/sr)
        sel=(freqs>=50)&(freqs<=8000)
        power=mag**2
        centroid=float((freqs[sel]*power[sel]).sum()/max(power[sel].sum(),1e-30))
        peak=float(freqs[np.where(sel)[0][np.argmax(mag[sel])]])
        rows.append({"time_s":(start+nfft/2)/sr,"peak_hz":peak,"centroid_hz":centroid})
    return rows

results=[]
for p in sorted(root.rglob("*.wav")):
    sr,x=read_wav(p)
    steady=x[int(sr*1.5):] if len(x)>int(sr*2) else x
    results.append({
        "file":p.name,"sample_rate_hz":sr,"duration_s":len(x)/sr,
        "rms":float(np.sqrt(np.mean(x*x))),"peak":float(np.max(np.abs(x))),
        "steady":spectrum_metrics(sr,steady),
        "stft":stft_summary(sr,x)
    })
obj={"schema":"sho-wave4-audio-diagnostics-v1","source_run_id":36294819923,"note":"Source WAV files were individually normalized during render; RMS/peak are not cross-file physical amplitude comparisons.","files":results}
(out/"audio-diagnostics.json").write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"files":[{"file":x["file"],"dominant_hz":x["steady"]["dominant_hz"],"centroid_hz":x["steady"]["spectral_centroid_hz"],"floor_db":x["steady"]["median_floor_db_rel"]} for x in results]},ensure_ascii=False,indent=2))
