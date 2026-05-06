// Re-export the planGate module surface. The implementation lives in
// `./planGate/`, split into focused sub-modules (plan, features, usage,
// credits, checkout, assertions). This shim preserves the public import
// path `'../lib/planGate.js'` so all consumers stay unchanged.
export * from './planGate/index.js';
