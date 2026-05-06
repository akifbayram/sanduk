export function formatApplyDescription(
  counts: { kept: number; deleted: number; created: number },
  binWord: string,
  binsWord: string,
): string {
  const word = (n: number) => (n === 1 ? binWord : binsWord);
  const parts: string[] = [];
  if (counts.kept > 0) parts.push(`update ${counts.kept} existing ${word(counts.kept)} in place`);
  if (counts.deleted > 0) parts.push(`delete ${counts.deleted} ${word(counts.deleted)}`);
  if (counts.created > 0) parts.push(`create ${counts.created} new ${word(counts.created)}`);
  if (parts.length === 0) return 'This will apply the reorganization.';
  if (parts.length === 1) return `This will ${parts[0]}.`;
  if (parts.length === 2) return `This will ${parts[0]} and ${parts[1]}.`;
  return `This will ${parts[0]}, ${parts[1]}, and ${parts[2]}.`;
}
