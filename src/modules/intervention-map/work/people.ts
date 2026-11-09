// Who did something, by name. The person signed in may not be on the members list, as in local mode.
import type { AppUser, MapData } from '../data/types';

export function personName(data: Pick<MapData, 'members'>, user: AppUser, id: string | null): string {
  if (id === null) return 'someone';
  return data.members.find((member) => member.id === id)?.full_name ?? (id === user.id ? user.full_name : null) ?? 'someone';
}
