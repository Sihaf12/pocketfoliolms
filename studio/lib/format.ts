/** Words for the things the API names in codes. The studio never shows a code. */
export type ReviewState = 'draft' | 'in_expert_review' | 'in_compliance_review' | 'published' | 'rejected' | 'retired';
export type Tier = 'learn' | 'safeguard' | 'apply' | 'specialise';

export const TIERS: Tier[] = ['learn', 'safeguard', 'apply', 'specialise'];
export const TIER_NAME: Record<Tier, string> = { learn: 'Learn', safeguard: 'Safeguard', apply: 'Apply', specialise: 'Specialise' };

export const STATE: Record<ReviewState, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  in_expert_review: { label: 'In expert review', tone: 'caution' },
  in_compliance_review: { label: 'In compliance review', tone: 'caution' },
  published: { label: 'Published', tone: 'success' },
  rejected: { label: 'Sent back', tone: 'danger' },
  retired: { label: 'Withdrawn', tone: '' },
};

export type Action = 'submit' | 'approve' | 'reject' | 'publish' | 'retire' | 'revise';
export const ACTION_LABEL: Record<Action, string> = {
  submit: 'Send for review',
  approve: 'Approve for compliance',
  reject: 'Send back with notes',
  publish: 'Publish to learners',
  retire: 'Withdraw course',
  revise: 'Start a revision',
};
/** Which action leads, when a person could take more than one. */
export const ACTION_ORDER: Action[] = ['publish', 'approve', 'submit', 'revise', 'reject', 'retire'];

export const FIELD_NAME: Record<string, string> = {
  title: 'Title', summary: 'Summary', tier: 'Tier', estMinutes: 'Length', placementQuestions: 'Placement questions',
  position: 'Position', bodyMd: 'Lesson text', videoAsset: 'Video', transcript: 'Transcript', minutes: 'Minutes',
  xp: 'XP', requires: 'Required lessons', questions: 'Check questions', courseId: 'Course',
  term: 'Term', definition: 'Definition', related: 'Related terms',
  prompt: 'question text', text: 'text', correctKey: 'right answer', at: 'time',
  email: 'Email', password: 'Password', displayName: 'Name', roles: 'Roles', role: 'Role',
  name: 'Name', slug: 'Short name', primaryDomain: 'Domain', adminEmail: 'First admin\'s email',
  domain: 'Domain', url: 'Endpoint', secret: 'Signing secret', clearSecret: 'Remove the secret',
  notes: 'Notes', reason: 'Reason', sub: 'Tagline', signoffs: 'Review rule', code: 'Code',
  enabled: 'Offered', status: 'Status',
};

export const ROLE_NAME: Record<string, string> = {
  author: 'Author', reviewer: 'Reviewer', compliance: 'Compliance', tenant_admin: 'Admin',
  platform_owner: 'Owner', platform_author: 'Author', platform_reviewer: 'Reviewer', platform_compliance: 'Compliance',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = (iso: string | null | undefined) => (iso ? dateFormat.format(new Date(iso)) : '');
export const moment = (iso: string | null | undefined) => (iso ? timeFormat.format(new Date(iso)) : '');

/** "3 hours", "2 days": how long something has waited. */
export function waited(iso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
