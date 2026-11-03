# Explainer videos

These scripts make the narrated, captioned explainer videos of the CRM. Each run records the
**local** app with fake demo data (never staging or live, because staging sends real WhatsApp
messages), adds a voice track made on this computer, and burns in captions.

Output goes to `~/Videos/pearl-crm-videos/` as `<n>-<name>.mp4` with a matching `.srt` caption file.
Working files (frames, phone clips, voice) go to `~/Videos/pearl-crm-videos/_work/`. Nothing goes in git.

| Script (`scripts/`) | Video |
|---|---|
| `inventory.mjs` | 2: stock in, stock out, pharmacy bill |
| `patient-journey.mjs` | 3: new patient → appointment → WhatsApp → prescription → admission → final bill |
| `leads.mjs` | 4: leads, from enquiry to patient (web + sales executive's phone) |
| `bdm.mjs` | 5: BDM field work (BDM's phone + admin's computer) |

## What you need
- Docker, then `pnpm db:start` (local Supabase).
- VoiceStudio installed, with its "Demo Voice" (`tts.py` uses the same voice, settings and seed for every line).
- `ffmpeg`, and Playwright's Chromium (`pnpm exec playwright install chromium`).
- For phone scenes: Android SDK with the `Pixel_10_Pro` emulator. It runs with no window.

## Start the local pieces (once per session)
1. Recording copy of the web app on port 3418:
   ```sh
   . scripts/videos/web-env.sh && (cd web && pnpm exec next build && pnpm exec next start -p 3418)
   ```
2. Edge Functions (file uploads use the local storage; no WhatsApp/Meta/email keys):
   ```sh
   pnpm exec supabase functions serve --env-file "$(scripts/videos/functions-env.sh)"
   ```
   `functions-env.sh` also starts a tiny relay container, `pearl-s3`, that lets the functions reach
   storage. This computer's firewall blocks containers from reaching the host.
3. Videos with phone scenes only: `scripts/videos/build-apk.sh`, then
   `adb -s emulator-5554 install -r ~/Videos/pearl-crm-videos/_work/pearl-local.apk`.
   The APK talks to the local Supabase; your normal debug APK is put back afterwards.

## Make a video
```sh
node scripts/videos/make.mjs bdm            # voice → fresh demo data → record → build
node scripts/videos/make.mjs bdm --no-record   # rebuild from the last recording (e.g. after a caption change)
```
Every recording first runs `reset-demo.sh`: a fresh local database plus `demo-data.sql` and
`bdm-day.sql` (yesterday's BDM day; to change it, edit and run `gen-bdm-day.mjs`).

## Writing scenes
- `{ id, say, run(page) }`: a browser scene. The narration starts with it and the scene lasts at least as long as the voice.
- `{ id, say, phone: "Label", run(phone) }`: an emulator scene. It is shown on the left with the captions beside it.
- `{ offscreen: async (phone, page) => … }`: happens with the clock stopped, so it is not in the video (e.g. `phone.drive(route)` for the BDM's GPS).
- `{ chapter, description }`: a title card.
- Helpers: `lib/ui.mjs` (dropdowns, date pickers), `lib/phone.mjs` (`tap`, `fill`, `find`, `drive`, `geo`, `gsm`).
  `phone-cli.mjs` pokes the emulator while you write a script, and `probe.mjs` screenshots pages.

## Demo-only shortcuts
- The BDM's "Km expected" normally comes from OpenRouteService. Locally there is no key, so `bdm.mjs`
  saves an estimate of 1.3 × the straight-line distance (local database only).
- The emulator's camera shows a test pattern, so the BDM video does not open the selfie.
