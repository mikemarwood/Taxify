Place the signed release APK here as "taxify.apk" before running `npm run build`.
Vite copies everything in client/public/ into client/dist/, so this file ends up
served at https://taxify.mikesapphub.com/downloads/taxify.apk

Release checklist:
1. Bump versionCode/versionName in client/android/app/build.gradle
2. Bump the matching versionCode/versionName in server/src/app-version.json
3. Build + sign the release APK in Android Studio (Build > Generate Signed Bundle/APK)
4. Copy the output APK to client/public/downloads/taxify.apk (overwrite)
5. npm run build (client) and deploy as usual

The download button on the login page and the in-app update checker both always
point at this same file, so overwriting it here is enough to ship an update.
