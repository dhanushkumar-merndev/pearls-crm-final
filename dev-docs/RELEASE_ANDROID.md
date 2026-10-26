# Releasing the Android app

Staff install the app from an APK file you share, for example by WhatsApp or a Google Drive link, not from the Play Store. Each release is **signed** with the clinic's own key, so phones accept it as an update to the app they already have.

---

## 1. Make the signing key (one time, about 5 minutes)

**The key is the app's identity.** If it is lost, phones can't update: every phone would have to uninstall the app and lose its unsent data. Keep **two** copies, for example on the backup USB drive and in a password manager. Never put it in git or on GitHub; `.gitignore` already blocks `*.jks` and `keystore.properties`.

1. Open a terminal in the `android` folder.
2. Run this, choosing a strong password when it asks. The name questions can be answered with the clinic's name:
   ```
   keytool -genkeypair -keystore pearl-release.jks -alias pearl -keyalg RSA -keysize 2048 -validity 10000
   ```
   No `keytool`? Use the one in Android Studio's `jbr/bin` folder.
3. In the `android` folder, create a file called `keystore.properties` with:
   ```
   storeFile=pearl-release.jks
   storePassword=<the password>
   keyAlias=pearl
   keyPassword=<the password>
   ```
4. Copy `pearl-release.jks` and the password to your two safe places.

## 2. Point the app at the clinic's project

The app reads the server address from the root `.env`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. For a release, these must be the **clinic's live project**, not staging. To build once against another project without editing `.env`, set the two values as environment variables in the terminal first.

For push notifications, `android/app/google-services.json` must be the clinic's Firebase file (dev-docs/TRY_ANDROID.md step 1).

## 3. Build a release (every time, about 3 minutes)

1. Open `android/version.properties` and increase both numbers:
   - `versionCode`: +1 every release, always. Phones refuse an update with the same or a lower number.
   - `versionName`: what staff see, for example `1.0.0` → `1.1.0`.
2. In the `android` folder, run:
   ```
   ./gradlew test assembleRelease
   ```
   On Windows, use `gradlew.bat`. The tests run first; if one fails, nothing is built.
3. The app is `android/app/build/outputs/apk/release/app-release.apk`. Rename it to something like `PearlCRM-1.1.0.apk`.
4. Commit the version change: `git commit -am "Android 1.1.0"`. **Never** commit the `.jks` or `keystore.properties` files.

If the build says the APK is **unsigned** (`app-release-unsigned.apk`), `keystore.properties` wasn't found or the `storeFile` path is wrong.

## 4. Share it

1. Send the APK to staff (WhatsApp, Drive).
2. On the phone: open the file → **Install**. The first time, Android asks to allow installs from that app (WhatsApp or Files): **Settings → Allow from this source**.
3. An update installs over the old app and keeps the login, PIN and any unsent work.

## 5. If something goes wrong
- **"App not installed" / "package conflicts"**: the phone has a build signed with a different key, such as a test build. Before uninstalling, send any unsent work: with the internet on, open the app's **Settings → Sync now** and check that no "Couldn't be saved on the server" items are listed. Then uninstall and install again.
- **The app opens but can't log in**: step 2 was built against the wrong project.

## What the release build does
- The code is shrunk and obfuscated (R8), which makes the APK about 2.7 MB and harder to pick apart.
- The signing details come from `android/keystore.properties`, or in CI from the `PEARL_KEYSTORE_FILE`, `PEARL_KEYSTORE_PASSWORD`, `PEARL_KEY_ALIAS` and `PEARL_KEY_PASSWORD` environment variables.
- Checked on 26/10/2026 on the emulator: a release build signed with a test key opened, logged in, synced My day and saved a lead to the server. Nothing breaks under R8.
