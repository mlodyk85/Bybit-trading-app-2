import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiCredentials } from '../api/types';

const API_KEY_STORAGE_KEY = 'BYBIT_READONLY_API_KEY';
const API_SECRET_STORAGE_KEY = 'BYBIT_READONLY_API_SECRET';
const REMEMBER_DEVICE_KEY = 'BYBIT_REMEMBER_DEVICE';

// In-memory fallback for environments where SecureStore is not natively supported (e.g., Web/Jest)
const memoryStore: Record<string, string> = {};

async function isSecureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Saves API Key and API Secret securely using Expo SecureStore.
 */
export async function saveCredentials(apiKey: string, apiSecret: string, remember = true): Promise<void> {
  const trimmedKey = apiKey.trim();
  const trimmedSecret = apiSecret.trim();

  if (await isSecureStoreAvailable()) {
    await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, trimmedKey);
    await SecureStore.setItemAsync(API_SECRET_STORAGE_KEY, trimmedSecret);
    await SecureStore.setItemAsync(REMEMBER_DEVICE_KEY, remember ? 'true' : 'false');
  } else {
    memoryStore[API_KEY_STORAGE_KEY] = trimmedKey;
    memoryStore[API_SECRET_STORAGE_KEY] = trimmedSecret;
    memoryStore[REMEMBER_DEVICE_KEY] = remember ? 'true' : 'false';
  }
}

/**
 * Retrieves API Key and API Secret securely from Expo SecureStore.
 */
export async function getCredentials(): Promise<ApiCredentials | null> {
  try {
    let apiKey: string | null = null;
    let apiSecret: string | null = null;

    if (await isSecureStoreAvailable()) {
      apiKey = await SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
      apiSecret = await SecureStore.getItemAsync(API_SECRET_STORAGE_KEY);
    } else {
      apiKey = memoryStore[API_KEY_STORAGE_KEY] || null;
      apiSecret = memoryStore[API_SECRET_STORAGE_KEY] || null;
    }

    if (apiKey && apiSecret) {
      return { apiKey, apiSecret };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deletes API Key and API Secret from secure storage ("Usuń dane API").
 */
export async function deleteCredentials(): Promise<void> {
  try {
    if (await isSecureStoreAvailable()) {
      await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
      await SecureStore.deleteItemAsync(API_SECRET_STORAGE_KEY);
      await SecureStore.deleteItemAsync(REMEMBER_DEVICE_KEY);
    }
  } catch {
    // Ignore error on deletion
  } finally {
    delete memoryStore[API_KEY_STORAGE_KEY];
    delete memoryStore[API_SECRET_STORAGE_KEY];
    delete memoryStore[REMEMBER_DEVICE_KEY];
  }
}

/**
 * Checks if credentials remember option is set.
 */
export async function getRememberDevice(): Promise<boolean> {
  try {
    if (await isSecureStoreAvailable()) {
      const val = await SecureStore.getItemAsync(REMEMBER_DEVICE_KEY);
      return val === 'true';
    }
    return memoryStore[REMEMBER_DEVICE_KEY] === 'true';
  } catch {
    return true;
  }
}
