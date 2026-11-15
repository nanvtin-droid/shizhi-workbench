"""Optional local ASR; install through scripts/setup-asr.sh. Output JSON only."""
import argparse,json,sys,os
os.environ.setdefault("HF_HUB_DISABLE_XET","1")
from faster_whisper import WhisperModel
import imageio_ffmpeg
import os
import numpy as np
import subprocess
p=argparse.ArgumentParser();p.add_argument('file');p.add_argument('--model',default='base');p.add_argument('--cache',required=True);a=p.parse_args()
# PyAV (used by faster-whisper) decodes media directly; the ffmpeg binary is also
# available for deployments that choose compressed online transcription.
model=WhisperModel(a.model,device='cpu',compute_type='int8',download_root=a.cache,cpu_threads=4)
decoded=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',a.file,'-f','s16le','-ac','1','-ar','16000','-'],capture_output=True,check=True)
audio=np.frombuffer(decoded.stdout,dtype=np.int16).astype(np.float32)/32768.0
segments,info=model.transcribe(audio,beam_size=3,vad_filter=True,condition_on_previous_text=False)
rows=[{'start':round(s.start,2),'end':round(s.end,2),'text':s.text.strip()} for s in segments]
print(json.dumps({'text':'\n'.join(s['text'] for s in rows),'segments':rows,'language':info.language},ensure_ascii=False))
