/**
 * Expo config plugin: adds DOST's native listening pipeline to the Android
 * project at prebuild time.
 *
 *   1. Copies the Kotlin sources into com.dost.app.listening.
 *   2. Adds sherpa-onnx (arm64-v8a only, vendored) as a local AAR.
 *   3. Copies the speech-detector and speaker models into app assets.
 *   4. Declares ListenService as a microphone foreground service.
 *   5. Excludes filesDir/voice/ from cloud backup and device transfer.
 *   6. Builds for arm64-v8a only.
 *   7. Registers ListenPackage in MainApplication.
 *
 * Nothing here starts listening; sessions only start from a user action.
 */
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.dost.app';
const LISTEN_PACKAGE = `${PACKAGE}.listening`;
const SERVICE_CLASS = `${LISTEN_PACKAGE}.ListenService`;
const PACKAGE_CLASS = `${LISTEN_PACKAGE}.ListenPackage`;
const AAR_NAME = 'sherpa-onnx-1.13.8-arm64-v8a.aar';
const MODEL_FILES = ['dost_silero_vad.onnx', 'dost_speaker_eres2net.onnx'];
const BACKUP_RULES = 'dost_backup_rules';
const EXTRACTION_RULES = 'dost_data_extraction_rules';

const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Voice recordings, logs and voiceprints never go into backups. -->
<full-backup-content>
  <exclude domain="file" path="voice/" />
</full-backup-content>
`;

const EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Voice recordings, logs and voiceprints never leave the phone. -->
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="file" path="voice/" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="file" path="voice/" />
  </device-transfer>
</data-extraction-rules>
`;

// Material "mic" icon (Apache-2.0), white for the status bar.
const STATUS_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11L5,11c0,3.41 2.72,6.23 6,6.72L11,21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z" />
</vector>
`;

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function writeFile(dst, contents) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, contents, 'utf8');
}

function withListeningFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pluginDir = path.join(cfg.modRequest.projectRoot, 'plugins', 'listening');
      const appDir = path.join(cfg.modRequest.platformProjectRoot, 'app');
      const mainDir = path.join(appDir, 'src', 'main');

      const kotlinSrc = path.join(pluginDir, 'kotlin');
      const kotlinDst = path.join(mainDir, 'java', ...LISTEN_PACKAGE.split('.'));
      for (const file of fs.readdirSync(kotlinSrc)) {
        if (file.endsWith('.kt')) copyFile(path.join(kotlinSrc, file), path.join(kotlinDst, file));
      }

      copyFile(path.join(pluginDir, 'vendor', AAR_NAME), path.join(appDir, 'libs', AAR_NAME));

      for (const model of MODEL_FILES) {
        copyFile(path.join(pluginDir, 'models', model), path.join(mainDir, 'assets', model));
      }

      const res = path.join(mainDir, 'res');
      writeFile(path.join(res, 'xml', `${BACKUP_RULES}.xml`), BACKUP_RULES_XML);
      writeFile(path.join(res, 'xml', `${EXTRACTION_RULES}.xml`), EXTRACTION_RULES_XML);
      writeFile(path.join(res, 'drawable', 'dost_listening_status.xml'), STATUS_ICON_XML);
      return cfg;
    },
  ]);
}

function withSherpaDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    const line = `    implementation files("libs/${AAR_NAME}")`;
    let src = cfg.modResults.contents;
    if (!src.includes(line)) {
      const match = /^dependencies\s*\{\s*$/m.exec(src);
      if (!match) throw new Error('withListening: dependencies block not found in app/build.gradle');
      const at = match.index + match[0].length;
      src = `${src.slice(0, at)}\n${line}${src.slice(at)}`;
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withArm64Only(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'reactNativeArchitectures';
    const props = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === key));
    props.push({ type: 'property', key, value: 'arm64-v8a' });
    cfg.modResults = props;
    return cfg;
  });
}

function withListeningManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) throw new Error('withListening: <application> not found in AndroidManifest');

    application.service = application.service ?? [];
    if (!application.service.some((s) => s.$?.['android:name'] === SERVICE_CLASS)) {
      application.service.push({
        $: {
          'android:name': SERVICE_CLASS,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone',
          'android:stopWithTask': 'false',
        },
      });
    }

    for (const [attr, value] of [
      ['android:fullBackupContent', `@xml/${BACKUP_RULES}`],
      ['android:dataExtractionRules', `@xml/${EXTRACTION_RULES}`],
    ]) {
      const existing = application.$[attr];
      if (existing && existing !== value) {
        throw new Error(
          `withListening: ${attr} is already ${existing}; merge its rules with ${value} so voice/ stays out of backups`,
        );
      }
      application.$[attr] = value;
    }
    return cfg;
  });
}

function withListenPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE_CLASS}`;
    if (!src.includes(importLine)) {
      src = src.replace(/(package [^\n]+\n)/, `$1\n${importLine}\n`);
    }
    if (!src.includes('ListenPackage()')) {
      if (/PackageList\(this\)\.packages\.apply\s*\{/.test(src)) {
        src = src.replace(
          /(PackageList\(this\)\.packages\.apply\s*\{[^\n]*\n)/,
          `$1              add(ListenPackage())\n`,
        );
      } else if (/val packages\s*=\s*PackageList\(this\)\.packages/.test(src)) {
        src = src.replace(
          /(val packages\s*=\s*PackageList\(this\)\.packages[^\n]*\n)/,
          `$1            packages.add(ListenPackage())\n`,
        );
      } else {
        throw new Error('withListening: could not find PackageList(this).packages in MainApplication');
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withListening(config) {
  config = withListeningFiles(config);
  config = withSherpaDependency(config);
  config = withArm64Only(config);
  config = withListeningManifest(config);
  config = withListenPackage(config);
  return config;
};
