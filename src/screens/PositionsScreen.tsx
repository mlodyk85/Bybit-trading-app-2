import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Position } from '../api/types';
import { PositionCard } from '../components/PositionCard';

interface PositionsScreenProps {
  positions: Position[];
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const PositionsScreen: React.FC<PositionsScreenProps> = ({
  positions,
  isRefreshing,
  onRefresh,
}) => {
  return (
    <View style={styles.container}>
      <FlatList
        data={positions}
        keyExtractor={(item) => `${item.category}-${item.symbol}-${item.side}`}
        renderItem={({ item }) => <PositionCard position={item} />}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#F0B90B"
            colors={['#F0B90B']}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>Otwarte Pozycje</Text>
              <Text style={styles.headerSubtitle}>
                {positions.length} {positions.length === 1 ? 'pozycja' : 'pozycji'} (Linear & Inverse)
              </Text>
            </View>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={onRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#F0B90B" />
              ) : (
                <Text style={styles.refreshButtonText}>🔄 Odśwież</Text>
              )}
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Brak otwartych pozycji</Text>
            <Text style={styles.emptySubtitle}>
              Twoje konto nie posiada obecnie żadnych aktywnych pozycji Linear ani Inverse.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  headerTitle: {
    color: '#F0B90B',
    fontSize: 24,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  refreshButton: {
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333333',
  },
  refreshButtonText: {
    color: '#F0B90B',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginVertical: 24,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
