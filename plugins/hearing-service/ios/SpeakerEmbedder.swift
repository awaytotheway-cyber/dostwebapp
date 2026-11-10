import Foundation
import onnxruntime_objc

/// Neural speaker embedding (WeSpeaker ResNet34, 256-dim) via ONNX
/// Runtime: the iOS counterpart of SpeakerEmbedder.kt.
///
/// Same division of labour as Android: JS computes the 80-bin Kaldi
/// filterbank (lib/hearing/fbank.ts) and sends it as base64 little-endian
/// float32, frames × 80; this class only runs the network. Same model
/// file, downloaded by JS into the app's documents directory, and the
/// same ONNX Runtime version (1.20.0) as Android, so both platforms
/// produce the same embedding for the same features.
///
/// Inference runs on its own serial queue so a forward pass never
/// blocks the module's other calls.
final class SpeakerEmbedder {
  static let featureDim = 80

  private let queue = DispatchQueue(label: "com.dost.hearing.embedder", qos: .userInitiated)
  private var env: ORTEnv?
  private var session: ORTSession?
  private var loadedPath: String?

  func embed(
    modelPath: String,
    featuresBase64: String,
    frames: Int,
    _ done: @escaping (Result<[Double], HearingError>) -> Void
  ) {
    queue.async {
      do {
        guard frames > 0 else {
          throw HearingError(code: "EMBED_INPUT", message: "No feature frames")
        }
        guard let bytes = Data(base64Encoded: featuresBase64) else {
          throw HearingError(code: "EMBED_INPUT", message: "Features are not valid base64")
        }
        let expected = frames * SpeakerEmbedder.featureDim * 4
        guard bytes.count == expected else {
          throw HearingError(code: "EMBED_INPUT", message: "Expected \(expected) bytes, got \(bytes.count)")
        }

        let sess = try self.sessionFor(modelPath)
        let inputName = try sess.inputNames().first ?? "feats"
        guard let outputName = try sess.outputNames().first else {
          throw HearingError(code: "EMBED_ERROR", message: "Model has no outputs")
        }
        let input = try ORTValue(
          tensorData: NSMutableData(data: bytes),
          elementType: .float,
          shape: [1, NSNumber(value: frames), NSNumber(value: SpeakerEmbedder.featureDim)]
        )
        let outputs = try sess.run(
          withInputs: [inputName: input],
          outputNames: [outputName],
          runOptions: nil
        )
        guard let value = outputs[outputName] else {
          throw HearingError(code: "EMBED_ERROR", message: "No output tensor")
        }
        // Shape is [1, 256]: the flat buffer is that one row, which is
        // what Android takes as `out[0]`.
        let data = try value.tensorData() as Data
        let embedding: [Double] = data.withUnsafeBytes { raw in
          raw.bindMemory(to: Float.self).map { Double($0) }
        }
        done(.success(embedding))
      } catch let e as HearingError {
        done(.failure(e))
      } catch {
        done(.failure(HearingError(code: "EMBED_ERROR", message: error.localizedDescription)))
      }
    }
  }

  func release() {
    queue.async {
      self.session = nil
      self.loadedPath = nil
    }
  }

  private func sessionFor(_ modelPath: String) throws -> ORTSession {
    // JS passes a file:// URI (expo-file-system's documentDirectory).
    let path: String
    if modelPath.hasPrefix("file://"), let url = URL(string: modelPath) {
      path = url.path
    } else {
      path = modelPath
    }
    if let current = session, loadedPath == path { return current }
    session = nil

    let ortEnv: ORTEnv
    if let existing = env {
      ortEnv = existing
    } else {
      ortEnv = try ORTEnv(loggingLevel: .warning)
      env = ortEnv
    }
    let opts = try ORTSessionOptions()
    try opts.setIntraOpNumThreads(2)
    try opts.setGraphOptimizationLevel(.all)
    let created = try ORTSession(env: ortEnv, modelPath: path, sessionOptions: opts)
    session = created
    loadedPath = path
    return created
  }
}
