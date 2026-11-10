# The iOS half of DOST listening sessions. The Android half is the Kotlin
# in ../kotlin, injected by plugins/withHearingService.js.
#
# Linked by Expo autolinking: package.json sets
# expo.autolinking.nativeModulesDir to ./plugins, which makes
# plugins/hearing-service a local Expo module, and its
# expo-module.config.json limits it to Apple platforms so Android is
# untouched.
Pod::Spec.new do |s|
  s.name           = 'DostHearing'
  s.version        = '1.0.0'
  s.summary        = 'DOST listening sessions for iOS'
  s.description    = 'Background speech capture, voice-activity detection, speaker enrollment and on-device speaker embedding for DOST listening sessions.'
  s.author         = 'DOST'
  s.homepage       = 'https://github.com/awaytotheway-cyber/dostwebapp'
  s.license        = { :type => 'Proprietary', :text => 'Private to the DOST app.' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Same ONNX Runtime version as Android's onnxruntime-android:1.20.0, so
  # both platforms compute the same speaker embedding. The config plugin
  # also declares this pod with modular headers: it ships no module map,
  # and Swift can only `import onnxruntime_objc` with one.
  s.dependency 'onnxruntime-objc', '1.20.0'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '*.swift'
end
