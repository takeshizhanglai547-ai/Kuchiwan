# assets/audio/vo_asr.py - offline speech-recognition sanity check for build_vo.py --check
# (pocketsphinx bundled en-US model; a weak recogniser: names it has never heard always miss).
import sys, numpy as np, soundfile as sf, re
from pocketsphinx import Decoder
from scipy.signal import resample_poly
def recog(path):
    x, sr = sf.read(path, dtype='float32')
    if x.ndim>1: x=x.mean(1)
    if sr!=16000: x=resample_poly(x,16000,sr)
    pcm=(np.clip(x,-1,1)*32767).astype(np.int16).tobytes()
    d=Decoder(samprate=16000)
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    h=d.hyp()
    return h.hypstr if h else ''
def wer(ref, hyp):
    r=re.sub(r"[^a-z' ]"," ",ref.lower()).split(); h=hyp.lower().split()
    D=np.zeros((len(r)+1,len(h)+1),int); D[:,0]=range(len(r)+1); D[0,:]=range(len(h)+1)
    for i in range(1,len(r)+1):
        for j in range(1,len(h)+1):
            D[i,j]=min(D[i-1,j]+1,D[i,j-1]+1,D[i-1,j-1]+(r[i-1]!=h[j-1]))
    return D[-1,-1]/max(1,len(r))
if __name__=='__main__':
    ref=sys.argv[1]
    for p in sys.argv[2:]:
        h=recog(p); print(f'{p}: WER {wer(ref,h):.2f} | {h}')
