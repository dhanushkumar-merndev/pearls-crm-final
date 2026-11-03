"""Narration for the explainer videos, made with the local VoiceStudio (OmniVoice) model.

One voice for every line: the same reference clip, the same clone prompt, the same settings and the
same seed, so all five videos sound like one continuous speaker.

Run with VoiceStudio's own Python (it has torch + omnivoice):
  ~/.config/VoiceStudio/runtime/project/.venv/bin/python scripts/videos/tts.py lines.json out_dir

lines.json: [{"id": "s01", "text": "..."}, ...]. Writes out_dir/<id>.wav and out_dir/durations.json.
A line whose wav already exists for the same text is skipped (re-runs only redo changed lines).
"""

import hashlib
import json
import os
import random
import sys

import numpy as np
import torch
import torchaudio

from omnivoice.models.omnivoice import OmniVoice

VOICE_WAV = os.path.expanduser("~/.local/share/voicestudio/data/voices/demo0001.wav")
VOICE_TEXT = (
    "Hey. I'm the VoiceStudio demo voice. I was made right here, on your machine: "
    "private, local, and ready whenever you are."
)
SEED = 20261103
SETTINGS = dict(num_step=32, guidance_scale=2.0, speed=1.0, t_shift=0.1, denoise=True, postprocess_output=True)


def main() -> None:
    lines_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    lines = json.load(open(lines_path))
    index_path = os.path.join(out_dir, "durations.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}

    todo = []
    for line in lines:
        key = hashlib.sha1(line["text"].encode()).hexdigest()
        wav = os.path.join(out_dir, f"{line['id']}.wav")
        if index.get(line["id"], {}).get("hash") == key and os.path.exists(wav):
            continue
        todo.append((line, key, wav))
    if not todo:
        print("nothing to do")
        return

    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda", dtype=torch.float16)
    prompt = model.create_voice_clone_prompt(ref_audio=VOICE_WAV, ref_text=VOICE_TEXT)
    sr = model.sampling_rate if hasattr(model, "sampling_rate") else 24000

    for line, key, wav in todo:
        random.seed(SEED)
        np.random.seed(SEED)
        torch.manual_seed(SEED)
        audio = model.generate(text=line["text"], language="English", voice_clone_prompt=prompt, **SETTINGS)[0]
        audio = audio if audio.dim() == 2 else audio.unsqueeze(0)
        torchaudio.save(wav, audio.float().cpu(), sr)
        index[line["id"]] = {"hash": key, "seconds": round(audio.shape[-1] / sr, 3)}
        json.dump(index, open(index_path, "w"), indent=1)
        print(f"{line['id']}: {index[line['id']]['seconds']} s")


if __name__ == "__main__":
    main()
