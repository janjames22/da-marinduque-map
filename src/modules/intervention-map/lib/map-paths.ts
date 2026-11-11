// The map's addresses. It lives at /map since Phase 12. Older links to / and /barangays/… and
// /records/… are sent here by src/app/routes.ts.
export const MAP_PATH = '/map';
export const BARANGAY_ROUTE = `${MAP_PATH}/barangays/:id`;
export const RECORD_ROUTE = `${MAP_PATH}/records/:id`;

export const barangayOnMap = (id: number | string) => `${MAP_PATH}/barangays/${id}`;
export const recordOnMap = (id: string) => `${MAP_PATH}/records/${id}`;
// The map, ready to place a new point. For Encoders and Admins, as the map's own button is.
export const ADD_ON_MAP = `${MAP_PATH}?add=1`;
// The dashboard's list of records waiting for verified coordinates.
export const AWAITING_LIST = '/dashboard#awaiting';
