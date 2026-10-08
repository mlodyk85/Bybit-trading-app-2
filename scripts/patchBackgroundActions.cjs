// Compatibility shim for react-native-background-actions 4.1.0 on Expo SDK 51
// (compileSdk 34 / older AndroidX core). Applied automatically after npm install.
// Keep the Android 14+ foreground-service type while avoiding API 35-only Java calls.
const fs = require('node:fs');
const path = require('node:path');

const moduleRoot = path.join(__dirname, '..', 'node_modules', 'react-native-background-actions');
const moduleInfo = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'));
if (moduleInfo.version !== '4.1.0') {
  throw new Error(`Unsupported react-native-background-actions version: ${moduleInfo.version}; review patch before upgrading.`);
}

const javaPath = path.join(moduleRoot, 'android', 'src', 'main', 'java', 'com', 'asterinet', 'react', 'bgactions', 'RNBackgroundActionsTask.java');
let java = fs.readFileSync(javaPath, 'utf8');
const replacements = [
  [
    'import androidx.core.app.ServiceCompat;\n',
    '',
  ],
  [
    `ServiceCompat.startForeground(
                this,
                SERVICE_NOTIFICATION_ID,
                notification,
                bgOptions.getForegroundServiceType()
            );`,
    `if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(SERVICE_NOTIFICATION_ID, notification, bgOptions.getForegroundServiceType());
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification);
            }`,
  ],
  [
    `@Override
    public void onTimeout(int startId, int fgsType) {
        super.onTimeout(startId, fgsType);
        stopSelf(startId);
    }`,
    `// Android 15 (API 35) callback. Omit @Override and the API-35-only
    // super call so this source also compiles against Expo SDK 51 (API 34).
    public void onTimeout(int startId, int fgsType) {
        stopSelf(startId);
    }`,
  ],
];
let changed = false;
for (const [before, after] of replacements) {
  if (java.includes(before)) {
    java = java.replace(before, after);
    changed = true;
  } else if (after && !java.includes(after)) {
    throw new Error(`Unexpected RNBackgroundActionsTask.java; expected pattern missing: ${before.slice(0, 75)}`);
  } else if (!after && java.includes('import androidx.core.app.ServiceCompat;')) {
    throw new Error('Could not remove obsolete ServiceCompat import.');
  }
}
if (java.includes('ServiceCompat.startForeground(') || java.includes('super.onTimeout(startId, fgsType);')) {
  throw new Error('Background actions Android compatibility patch incomplete.');
}
if (changed) fs.writeFileSync(javaPath, java);
console.log(changed ? 'Patched react-native-background-actions 4.1.0 for Android API 34.' : 'Background actions Android patch already applied.');
