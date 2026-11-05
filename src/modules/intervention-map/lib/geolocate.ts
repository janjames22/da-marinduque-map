import { roundPoint, type LatLng } from './coordinates';

export interface DevicePosition {
  point: LatLng;
  accuracyMetres: number;
}

export function getDevicePosition(): Promise<DevicePosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error('This browser only shares its location over a secure (https) connection. Enter the coordinates another way.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ point: roundPoint({ lat: coords.latitude, lng: coords.longitude }), accuracyMetres: Math.round(coords.accuracy) }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new Error('Location permission was refused. Allow it in the browser, or enter the coordinates another way.'));
        else if (error.code === error.TIMEOUT) reject(new Error('The device took too long to find its location. Try again outdoors.'));
        else reject(new Error('The device couldn\'t find its location.'));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
