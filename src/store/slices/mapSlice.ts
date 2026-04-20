import type { StateCreator } from 'zustand';
import type { WorldMap } from '../../types';
import { generateWorldMap, loadWorld } from '../../services/mapEngine/worldOrchestrator';

export type MapSlice = {
    overworldMap: WorldMap | null;
    isMapOpen: boolean;
    isMapLoading: boolean;
    playerPosition: { x: number; y: number };

    toggleMap: () => void;
    openMap: () => void;
    closeMap: () => void;
    setOverworldMap: (map: WorldMap | null) => void;
    setMapLoading: (loading: boolean) => void;
    setPlayerPosition: (pos: { x: number; y: number }) => void;
    generateMap: (campaignId: string, lore: string, llmConfig: { endpoint: string; apiKey: string; model: string }) => Promise<void>;
    loadMap: (campaignId: string) => Promise<void>;
};

type MapDeps = MapSlice;

export const createMapSlice: StateCreator<MapDeps, [], [], MapSlice> = (set, _get) => ({
    overworldMap: null,
    isMapOpen: false,
    isMapLoading: false,
    playerPosition: { x: 50, y: 50 },

    toggleMap: () => set((s) => ({ isMapOpen: !s.isMapOpen })),
    openMap: () => set({ isMapOpen: true }),
    closeMap: () => set({ isMapOpen: false }),
    setOverworldMap: (map) => set((s) => {
        const pos = map
            ? (s.overworldMap === null ? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) } : s.playerPosition)
            : s.playerPosition;
        return { overworldMap: map, playerPosition: pos };
    }),
    setMapLoading: (loading) => set({ isMapLoading: loading }),
    setPlayerPosition: (pos) => set({ playerPosition: pos }),

    generateMap: async (campaignId, lore, llmConfig) => {
        set({ isMapLoading: true });
        try {
            const map = await generateWorldMap(campaignId, lore, llmConfig);
            set({
                overworldMap: map,
                playerPosition: { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) },
                isMapLoading: false,
            });
        } catch (err) {
            console.error('[MapSlice] Generate failed:', err);
            set({ isMapLoading: false });
            throw err;
        }
    },

    loadMap: async (campaignId) => {
        set({ isMapLoading: true });
        try {
            const map = await loadWorld(campaignId);
            set({
                overworldMap: map,
                playerPosition: map
                    ? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) }
                    : { x: 50, y: 50 },
                isMapLoading: false,
            });
        } catch (err) {
            console.error('[MapSlice] Load failed:', err);
            set({ isMapLoading: false });
        }
    },
});