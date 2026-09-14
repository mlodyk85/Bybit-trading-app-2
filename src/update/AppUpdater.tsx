import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const RELEASE_API = 'https://api.github.com/repos/mlodyk85/Bybit-trading-app-2/releases/latest';
const APK_NAME = 'bybit-trading-app-release.apk';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface AvailableUpdate {
  tag: string;
  downloadUrl: string;
}

interface Props {
  currentVersion: string;
}

function normalizeVersion(version: string): number[] {
  return version.replace(/^v/i, '').split('.').map((part) => {
    const value = Number.parseInt(part.replace(/\D.*/, ''), 10);
    return Number.isFinite(value) ? value : 0;
  });
}

function isNewerVersion(remote: string, local: string): boolean {
  const a = normalizeVersion(remote);
  const b = normalizeVersion(local);
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

export async function checkLatestUpdate(currentVersion: string): Promise<AvailableUpdate | null> {
  if (Platform.OS !== 'android') return null;
  const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`Serwer aktualizacji: HTTP ${response.status}`);
  const release = (await response.json()) as GithubRelease;
  const asset = release.assets?.find((item) => item.name === APK_NAME || item.name.endsWith('.apk'));
  if (!asset || !isNewerVersion(release.tag_name, currentVersion)) return null;
  return { tag: release.tag_name, downloadUrl: asset.browser_download_url };
}

export async function downloadAndInstallUpdate(url: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Aktualizacja APK jest dostępna tylko na Androidzie.');
  const target = `${FileSystem.cacheDirectory}${APK_NAME}`;
  const result = await FileSystem.downloadAsync(url, target, { headers: { Accept: 'application/octet-stream' } });
  if (result.status < 200 || result.status >= 300) throw new Error(`Pobieranie APK: HTTP ${result.status}`);
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1,
    type: 'application/vnd.android.package-archive',
  });
}

export const AppUpdater: React.FC<Props> = ({ currentVersion }) => {
  const checked = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [progressText, setProgressText] = useState('');

  const install = useCallback(async (url: string, tag: string) => {
    if (downloading || Platform.OS !== 'android') return;
    setDownloading(true);
    setProgressText(`Pobieranie ${tag}...`);
    try {
      await downloadAndInstallUpdate(url);
      setProgressText('Otwieranie instalatora...');
    } catch (error: unknown) {
      Alert.alert('Aktualizacja nieudana', error instanceof Error ? error.message : 'Nie udało się pobrać lub otworzyć aktualizacji.');
    } finally {
      setDownloading(false);
      setProgressText('');
    }
  }, [downloading]);

  useEffect(() => {
    if (Platform.OS !== 'android' || checked.current) return;
    checked.current = true;
    void (async () => {
      try {
        const update = await checkLatestUpdate(currentVersion);
        if (!update) return;
        Alert.alert(
          'Dostępna aktualizacja',
          `Nowa wersja ${update.tag} jest gotowa. Android poprosi tylko o potwierdzenie instalacji.`,
          [
            { text: 'Później', style: 'cancel' },
            { text: 'Aktualizuj', onPress: () => void install(update.downloadUrl, update.tag) },
          ]
        );
      } catch {
        // Brak połączenia z serwerem aktualizacji nie blokuje działania aplikacji.
      }
    })();
  }, [currentVersion, install]);

  if (!downloading) return null;
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.card}>
        <ActivityIndicator color="#F0B90B" />
        <Text style={styles.text}>{progressText}</Text>
        <TouchableOpacity disabled style={styles.button}><Text style={styles.buttonText}>Aktualizacja w toku</Text></TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 12, right: 12, top: 42, zIndex: 9999, alignItems: 'center' },
  card: { minWidth: 240, backgroundColor: '#202020', borderWidth: 1, borderColor: '#3A3A3A', borderRadius: 12, padding: 14, alignItems: 'center' },
  text: { color: '#FFFFFF', marginTop: 8, fontSize: 13 },
  button: { marginTop: 8 },
  buttonText: { color: '#F0B90B', fontSize: 11, fontWeight: '700' },
});
