const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Required for expo-sqlite web (wa-sqlite.wasm).
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm'])];
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'wasm');

const COEP_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function applyCoepHeaders(res) {
  res.setHeader('Cross-Origin-Embedder-Policy', COEP_HEADERS['Cross-Origin-Embedder-Policy']);
  res.setHeader('Cross-Origin-Opener-Policy', COEP_HEADERS['Cross-Origin-Opener-Policy']);
}

// Metro bundle/asset responses.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    applyCoepHeaders(res);
    return middleware(req, res, next);
  };
};

// HTML shell is served before Metro middleware; patch Expo's web template handler.
try {
  const manifestMiddlewarePath = path.join(
    path.dirname(require.resolve('expo/package.json')),
    'node_modules/@expo/cli/build/src/start/server/middleware/ManifestMiddleware.js',
  );
  const { ManifestMiddleware } = require(manifestMiddlewarePath);
  const originalHandleWebRequest = ManifestMiddleware.prototype.handleWebRequestAsync;

  ManifestMiddleware.prototype.handleWebRequestAsync = async function handleWebRequestAsync(
    req,
    res,
  ) {
    applyCoepHeaders(res);
    return originalHandleWebRequest.call(this, req, res);
  };
} catch {
  // Non-fatal if Expo's internals move between versions.
}

module.exports = config;
