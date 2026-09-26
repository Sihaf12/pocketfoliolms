/**
 * Rules about lesson fields that both the API and the studio apply, so
 * the studio can say what is wrong while the author types and the API
 * refuses exactly the same things.
 */

/**
 * A lesson's video is a reference to an asset in the media store, never
 * a web address: letters, digits and / _ . - only, starting with a letter
 * or digit, up to 300 characters.
 */
export const VIDEO_ASSET = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$/;

export const VIDEO_ASSET_FORMAT =
  'Letters, digits and / _ . - only, with no spaces, starting with a letter or digit. For example: lessons/reading-a-spread.mp4';

/** What is wrong with a video reference, or null if it is fine. Empty means no video. */
export function videoAssetProblem(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (/^[a-z]+:\/\//i.test(value)) return 'Use the asset\'s name in the media store, not a web address.';
  if (/\s/.test(value)) return 'Take out the spaces.';
  if (value.length > 300) return 'Use at most 300 characters.';
  if (!/^[A-Za-z0-9]/.test(value)) return 'Start with a letter or a digit.';
  if (!VIDEO_ASSET.test(value)) return 'Use only letters, digits and / _ . -';
  return null;
}
