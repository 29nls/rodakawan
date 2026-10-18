/**
 * Pelacakan lokasi perjalanan (foreground + background Android).
 *
 * Prinsip yang dipegang (ADR-065):
 * - Consent aplikasi (`sharing_location` di database) adalah syarat pertama;
 *   izin OS saja tidak pernah menyalakan pengiriman.
 * - Izin foreground diminta hanya saat pengguna menyalakan berbagi.
 * - Izin background diminta terpisah setelah penjelasan, dan penolakannya bukan
 *   kesalahan — sesi foreground tetap berjalan.
 * - Saat berbagi dimatikan, task dihentikan dan server-side consent dimatikan
 *   oleh pemanggil (`setRideLocationSharing`) sebelum UI mengklaim berhenti.
 * - Tidak ada log koordinat: kegagalan diteruskan sebagai pesan tanpa angka.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { publishRideLocation } from '@/features/rides/api';
import {
  LOCATION_MIN_DISTANCE_M,
  LOCATION_MIN_INTERVAL_MS,
  shouldPublishLocation,
  type PreviousLocation,
} from '@/features/rides/location';
import { getSupabaseClient } from '@/lib/supabase/client';

export const RIDE_LOCATION_TASK = 'rodakawan-ride-location';
const TRACKED_RIDE_KEY = 'rodakawan.ride.tracking.rideId';

export type TrackingPermissionState = 'granted' | 'denied' | 'undetermined';

export type TrackingResult = { ok: true } | { ok: false; message: string };

function storage(): Storage | undefined {
  const value = (globalThis as { localStorage?: Storage }).localStorage;
  return value;
}

function rememberTrackedRide(rideId: string | null): void {
  const store = storage();
  if (!store) return;

  if (rideId === null) store.removeItem(TRACKED_RIDE_KEY);
  else store.setItem(TRACKED_RIDE_KEY, rideId);
}

export function readTrackedRideId(): string | null {
  return storage()?.getItem(TRACKED_RIDE_KEY) ?? null;
}

let lastSent: PreviousLocation | null = null;

function toPermissionState(status: Location.PermissionStatus): TrackingPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

export async function getForegroundPermissionState(): Promise<TrackingPermissionState> {
  const result = await Location.getForegroundPermissionsAsync();
  return toPermissionState(result.status);
}

export async function getBackgroundPermissionState(): Promise<TrackingPermissionState> {
  const result = await Location.getBackgroundPermissionsAsync();
  return toPermissionState(result.status);
}

/** Minta izin foreground. Dipanggil hanya dari aksi pengguna. */
export async function requestForegroundPermission(): Promise<TrackingPermissionState> {
  const result = await Location.requestForegroundPermissionsAsync();
  return toPermissionState(result.status);
}

/** Minta izin background. Hanya setelah pengguna membaca penjelasannya. */
export async function requestBackgroundPermission(): Promise<TrackingPermissionState> {
  const result = await Location.requestBackgroundPermissionsAsync();
  return toPermissionState(result.status);
}

export async function isRideLocationTrackingActive(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(RIDE_LOCATION_TASK);
}

if (!TaskManager.isTaskDefined(RIDE_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
    RIDE_LOCATION_TASK,
    async ({ data, error }) => {
      if (error) return;

      const rideId = readTrackedRideId();
      const client = getSupabaseClient();
      if (!rideId || !client) return;

      const now = Date.now();
      for (const location of data.locations ?? []) {
        const fix = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null,
          heading: location.coords.heading ?? null,
          speed: location.coords.speed ?? null,
          recordedAt: location.timestamp,
        };

        const decision = shouldPublishLocation(fix, lastSent, now);
        if (!decision.publish) continue;

        const result = await publishRideLocation(client, rideId, {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
          heading: fix.heading,
          speed: fix.speed,
          recordedAt: new Date(fix.recordedAt).toISOString(),
        });

        // Kegagalan (mis. consent sudah dimatikan di server) sengaja tidak
        // dicatat koordinatnya; task berhenti mengirim sampai update berikutnya.
        if (result.ok) {
          lastSent = {
            latitude: fix.latitude,
            longitude: fix.longitude,
            sentAt: now,
          };
        }
      }
    },
  );
}

/**
 * Mulai task lokasi untuk satu perjalanan. Task lama selalu dihentikan lebih
 * dulu supaya tidak ada dua task/interval yang tumpang tindih.
 */
export async function startRideLocationTracking(rideId: string): Promise<TrackingResult> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(RIDE_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(RIDE_LOCATION_TASK);
    }

    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== Location.PermissionStatus.GRANTED) {
      return { ok: false, message: 'Izin lokasi belum diberikan.' };
    }

    const background = await Location.getBackgroundPermissionsAsync();
    const backgroundGranted = background.status === Location.PermissionStatus.GRANTED;

    rememberTrackedRide(rideId);
    lastSent = null;

    await Location.startLocationUpdatesAsync(RIDE_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: LOCATION_MIN_INTERVAL_MS,
      distanceInterval: LOCATION_MIN_DISTANCE_M,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: backgroundGranted
        ? {
            notificationTitle: 'RodaKawan sedang berbagi lokasi',
            notificationBody:
              'Posisi Anda terlihat oleh peserta perjalanan. Hentikan dari aplikasi kapan saja.',
            notificationColor: '#F97316',
          }
        : undefined,
    });

    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        'Pelacakan tidak dapat dimulai di perangkat ini. Periksa izin lokasi dan layanan GPS, lalu coba lagi.',
    };
  }
}

/** Hentikan task dan lupakan perjalanan yang dilacak. */
export async function stopRideLocationTracking(): Promise<void> {
  lastSent = null;
  rememberTrackedRide(null);

  try {
    if (await TaskManager.isTaskRegisteredAsync(RIDE_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(RIDE_LOCATION_TASK);
    }
  } catch {
    // Task mungkin sudah berhenti oleh sistem; tidak ada yang perlu dipulihkan.
  }
}
