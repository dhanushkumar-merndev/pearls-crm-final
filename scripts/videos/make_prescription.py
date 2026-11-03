"""Fake sample prescription for the patient-flow video (clearly marked as a training sample).
Run with any Python that has Pillow, e.g. VoiceStudio's: .venv/bin/python scripts/videos/make_prescription.py"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "assets", "prescription.jpg")
W, H = 1240, 1754
FONTS = "/usr/share/fonts/noto/NotoSans-{}.ttf"
f = lambda size, style="Regular": ImageFont.truetype(FONTS.format(style), size)
teal, ink, grey = (16, 120, 110), (20, 30, 90), (70, 80, 80)

im = Image.new("RGB", (W, H), (250, 249, 244))
d = ImageDraw.Draw(im)
d.rectangle([0, 0, W, 190], fill=(232, 244, 241))
d.text((70, 40), "Pearl Aesthetic Clinic", font=f(56, "Bold"), fill=teal)
d.text((70, 118), "Jayanagar 4th Block, Bengaluru", font=f(26), fill=grey)
d.text((W - 470, 40), "Dr Arjun Shetty", font=f(36, "Bold"), fill=(30, 40, 40))
d.text((W - 470, 92), "MS, MCh (Plastic Surgery)", font=f(24), fill=grey)
d.text((W - 470, 126), "Reg. No. KMC 00000 (demo)", font=f(24), fill=grey)
d.line([60, 215, W - 60, 215], fill=teal, width=3)
y = 250
for k, v in [("Patient", "Meera Joshi    F / 32 yrs"), ("UHID", "PC1031"), ("Date", "03/11/2026")]:
    d.text((70, y), k + ":", font=f(30, "Bold"), fill=(40, 40, 40))
    d.text((260, y), v, font=f(30), fill=(40, 40, 40))
    y += 50
y += 20
d.text((70, y), "Diagnosis:", font=f(30, "Bold"), fill=(40, 40, 40))
d.text((260, y), "Nasal hump with mild deviated septum", font=f(30, "Italic"), fill=ink)
y += 90
d.text((70, y), "Rx", font=f(84, "Bold"), fill=teal)
y += 120
for t in ["1. Tab. Cetirizine 10 mg — 1 at night × 5 days", "2. Mupirocin 2% ointment — apply twice daily",
          "3. Saline nasal spray — 2 puffs, 3 times a day", "", "Advice:",
          "• Rhinoplasty + septoplasty planned (IP admission)", "• Pre-op: CBC, blood sugar, ECG",
          "• Nil by mouth 8 hours before surgery", "• Review after 7 days"]:
    d.text((110, y), t, font=f(34, "Italic"), fill=ink)
    y += 66
d.line([W - 480, H - 260, W - 90, H - 260], fill=(60, 60, 60), width=2)
d.text((W - 430, H - 240), "Signature", font=f(26), fill=(80, 80, 80))
d.text((70, H - 120), "SAMPLE FOR TRAINING — NOT A REAL PRESCRIPTION", font=f(24, "Bold"), fill=(170, 60, 60))
im.rotate(0.6, fillcolor=(250, 249, 244), resample=Image.BICUBIC).save(OUT, quality=88)
print(OUT)
