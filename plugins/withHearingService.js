/**
 * Expo config plugin: injects the DOST hearing foreground service into
 * the native Android project.
 *
 * What this plugin does:
 *   1. Copies HearingService.kt / HearingModule.kt / HearingPackage.kt
 *      into android/app/src/main/java/com/dost/app/hearing/
 *   2. Adds a <service> entry to AndroidManifest.xml with
 *      android:foregroundServiceType="microphone" and
 *      android:exported="false".
 *   3. Registers HearingPackage() in MainApplication.kt so RN can
 *      resolve NativeModules.HearingModule.
 *
 * The service is session-based only. It is started explicitly by a JS
 * call and stopped either from JS or from the notification's Stop
 * action — never on boot, never on schedule.
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.dost.app';
const SERVICE_CLASS = 'com.dost.app.hearing.HearingService';
const PACKAGE_CLASS = 'com.dost.app.hearing.HearingPackage';
const KOTLIN_FILES = [
  'HearingService.kt',
  'HearingModule.kt',
  'HearingPackage.kt',
  'EnrollmentRecorder.kt',
];

function withHearingKotlinSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const src = path.join(projectRoot, 'plugins', 'hearing-service', 'kotlin');
      const packagePath = PACKAGE.replace(/\./g, '/');
      const dst = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath,
        'hearing'
      );
      fs.mkdirSync(dst, { recursive: true });
      for (const filename of KOTLIN_FILES) {
        const s = path.join(src, filename);
        const d = path.join(dst, filename);
        const content = fs.readFileSync(s, 'utf8');
        fs.writeFileSync(d, content, 'utf8');
      }
      return cfg;
    },
  ]);
}

function withHearingServiceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application =
      manifest.manifest.application && manifest.manifest.application[0];
    if (!application) {
      throw new Error('withHearingService: <application> not found in manifest');
    }
    application.service = application.service || [];
    const already = application.service.find(
      (s) => s.$ && s.$['android:name'] === SERVICE_CLASS
    );
    if (already) return cfg;
    application.service.push({
      $: {
        'android:name': SERVICE_CLASS,
        'android:exported': 'false',
        'android:foregroundServiceType': 'microphone',
        'android:stopWithTask': 'false',
      },
    });
    return cfg;
  });
}

function withHearingPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE_CLASS}`;
    if (!src.includes(importLine)) {
      // Insert after the package declaration.
      src = src.replace(
        /(package [^\n]+\n)/,
        `$1\n${importLine}\n`
      );
    }

    if (!src.includes('HearingPackage()')) {
      // Expo's Kotlin MainApplication uses PackageList(this).packages and
      // often returns it directly. Handle the common shapes:
      //   1. `return packages` after a `val packages = PackageList(this).packages`
      //   2. `return PackageList(this).packages.apply { ... }`
      //   3. A direct `return PackageList(this).packages` with no locals
      if (/val packages\s*=\s*PackageList\(this\)\.packages/.test(src)) {
        src = src.replace(
          /(val packages\s*=\s*PackageList\(this\)\.packages[^\n]*\n)/,
          `$1              packages.add(HearingPackage())\n`
        );
      } else if (/PackageList\(this\)\.packages\.apply\s*\{/.test(src)) {
        src = src.replace(
          /(PackageList\(this\)\.packages\.apply\s*\{[^\n]*\n)/,
          `$1                add(HearingPackage())\n`
        );
      } else if (/return PackageList\(this\)\.packages/.test(src)) {
        src = src.replace(
          /return PackageList\(this\)\.packages/,
          `return PackageList(this).packages.toMutableList().apply { add(HearingPackage()) }`
        );
      } else {
        throw new Error(
          'withHearingService: could not locate PackageList(this).packages in MainApplication.kt'
        );
      }
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withHearingService(config) {
  config = withHearingKotlinSources(config);
  config = withHearingServiceManifest(config);
  config = withHearingPackageRegistration(config);
  return config;
};
