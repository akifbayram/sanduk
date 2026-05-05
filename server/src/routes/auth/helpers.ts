import { queryMaybeOne } from '../../lib/queryHelpers.js';

export async function isLocationMember(locationId: string, userId: string): Promise<boolean> {
  const row = await queryMaybeOne(
    'SELECT 1 FROM location_members WHERE location_id = $1 AND user_id = $2',
    [locationId, userId],
  );
  return row !== null;
}
