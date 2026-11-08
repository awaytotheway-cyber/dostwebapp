/**
 * Expo config plugin: injects DOST listening sessions into both native
 * projects.
 *
 * ANDROID — the Kotlin foreground service:
 * What this plugin does:
 *   1. Copies HearingService.kt / HearingModule.kt / HearingPackage.kt
 *      into android/app/src/main/java/com/dost/app/hearing/
 *   2. Adds a <service> entry to AndroidManifest.xml with
 *      android:foregroundServiceType="microphone" and
 *      android:exported="false".
 *   3. Registers HearingPackage() in MainApplication.kt so RN can
 *      resolve NativeModules.HearingModule.
 *   4. Adds ONNX Runtime (Maven Central) to app/build.gradle for the
 *      neural speaker-embedding model used by the speaker gate.
 *
 * The service is session-based only. It is started explicitly by a JS
 * call and stopped either from JS or from the notification's Stop
 * action — never on boot, never on schedule.
 *
 * iOS — the Swift module in plugins/hearing-service/ios/ is linked by
 * Expo autolinking (package.json: expo.autolinking.nativeModulesDir), not
 * copied in by this plugin. This plugin only adds what autolinking can't:
 *   5. The `audio` background mode in Info.plist, so a session the
 *      person started keeps capturing when they leave the app. iOS shows
 *      its microphone indicator for as long as it does.
 *   6. ONNX Runtime declared in the Podfile with modular headers. The pod
 *      ships no module map, and without one Swift cannot
 *      `import onnxruntime_objc`.
 */
const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
  withInfoPlist,
  withPodfile,
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
  'SpeakerEmbedder.kt',
];
const ONNXRUNTIME_DEP =
  "implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.20.0'";

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

function withOnnxRuntimeDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('com.microsoft.onnxruntime:onnxruntime-android')) return cfg;
    if (!/dependencies\s*\{/.test(src)) {
      throw new Error('withHearingService: dependencies block not found in app/build.gradle');
    }
    src = src.replace(/dependencies\s*\{/, (m) => `${m}\n    ${ONNXRUNTIME_DEP}`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

// Must match the dependency in plugins/hearing-service/ios/DostHearing.podspec
// and the Android version above, so both platforms run the same runtime.
const ONNXRUNTIME_POD = "pod 'onnxruntime-objc', '1.20.0', :modular_headers => true";

function withHearingBackgroundAudio(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
      ? cfg.modResults.UIBackgroundModes
      : [];
    if (!modes.includes('audio')) modes.push('audio');
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });
}

function withOnnxRuntimePod(config) {
  return withPodfile(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("pod 'onnxruntime-objc'")) return cfg;
    // Inside the app target, right after Expo's own module pods.
    if (!/^[ \t]*use_expo_modules![ \t]*$/m.test(src)) {
      throw new Error('withHearingService: use_expo_modules! not found in ios/Podfile');
    }
    // [ \t] rather than \s: \s also matches newlines, letting the match
    // run across neighbouring blank lines.
    src = src.replace(/^([ \t]*)use_expo_modules![ \t]*$/m, (line, indent) => `${line}\n${indent}${ONNXRUNTIME_POD}`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withHearingService(config) {
  // Android
  config = withHearingKotlinSources(config);
  config = withHearingServiceManifest(config);
  config = withHearingPackageRegistration(config);
  config = withOnnxRuntimeDependency(config);
  // iOS
  config = withHearingBackgroundAudio(config);
  config = withOnnxRuntimePod(config);
  return config;
};
