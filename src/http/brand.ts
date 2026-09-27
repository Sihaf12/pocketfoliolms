/**
 * Academy branding, as the API reads it from app.tenants.brand. The
 * contract and its validation live in packages/shared/brand.ts, the same
 * code the learner app and the studio write their tokens with.
 */
export { sanitiseBrand, type Brand } from '../../packages/shared/brand.js';
