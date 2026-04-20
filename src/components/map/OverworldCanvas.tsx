import { useEffect, useRef, useState } from 'react';
import { Application, Graphics, Container } from 'pixi.js';
import { useAppStore } from '../../store/useAppStore';
import { REGISTRIES } from '../../services/mapEngine/registries';

const DRAG_THRESHOLD = 5;
const OCEAN_COLOR = '#1a3d6e';

function getAllBiomes(): { id: string; color: string }[] {
    const merged: { id: string; color: string }[] = [];
    const seen = new Set<string>();
    for (const reg of Object.values(REGISTRIES)) {
        for (const b of reg) {
            if (!seen.has(b.id)) {
                seen.add(b.id);
                merged.push({ id: b.id, color: b.color });
            }
        }
    }
    return merged;
}

export function OverworldCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const worldRef = useRef<Container | null>(null);
    const playerRef = useRef<Graphics | null>(null);
    const cellSizeRef = useRef(10);
    const mapDimsRef = useRef({ w: 0, h: 0 });
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const containerStart = useRef({ x: 0, y: 0 });
    const deadRef = useRef(false);
    const [pixiReady, setPixiReady] = useState(false);

    const overworldMap = useAppStore(s => s.overworldMap);
    const playerPosition = useAppStore(s => s.playerPosition);
    const setPlayerPosition = useAppStore(s => s.setPlayerPosition);

    useEffect(() => {
        if (!containerRef.current) return;
        deadRef.current = false;

        const app = new Application();
        appRef.current = app;

        const init = async () => {
            await app.init({
                resizeTo: containerRef.current!,
                background: '#111118',
                antialias: false,
            });

            if (deadRef.current) return;

            containerRef.current!.appendChild(app.canvas as HTMLCanvasElement);

            const world = new Container();
            world.sortableChildren = true;
            app.stage.addChild(world);
            worldRef.current = world;

            const player = new Graphics();
            player.zIndex = 10;
            world.addChild(player);
            playerRef.current = player;

            app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
                isPanning.current = false;
                panStart.current = { x: e.clientX, y: e.clientY };
                containerStart.current = { x: world.x, y: world.y };
            });

            app.canvas.addEventListener('pointermove', (e: PointerEvent) => {
                if (e.buttons === 0) return;
                const dx = e.clientX - panStart.current.x;
                const dy = e.clientY - panStart.current.y;
                if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                    isPanning.current = true;
                }
                if (isPanning.current) {
                    world.x = containerStart.current.x + dx;
                    world.y = containerStart.current.y + dy;
                }
            });

            app.canvas.addEventListener('pointerup', (e: PointerEvent) => {
                if (isPanning.current) return;
                const { w, h } = mapDimsRef.current;
                if (w === 0 || h === 0) return;

                const rect = app.canvas.getBoundingClientRect();
                const localX = (e.clientX - rect.left - world.x) / world.scale.x;
                const localY = (e.clientY - rect.top - world.y) / world.scale.y;
                const cs = cellSizeRef.current;
                const gridCol = Math.floor(localX / cs);
                const gridRow = Math.floor(localY / cs);

                if (gridCol >= 0 && gridCol < w && gridRow >= 0 && gridRow < h) {
                    setPlayerPosition({ x: gridCol, y: gridRow });
                }
            });

            app.canvas.addEventListener('wheel', (e: WheelEvent) => {
                e.preventDefault();
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newScale = Math.max(0.3, Math.min(5, world.scale.x * zoomFactor));
                const rect = app.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const wx = (mouseX - world.x) / world.scale.x;
                const wy = (mouseY - world.y) / world.scale.y;
                world.scale.set(newScale);
                world.x = mouseX - wx * newScale;
                world.y = mouseY - wy * newScale;
            }, { passive: false });

            setPixiReady(true);
        };

        init();

        return () => {
            deadRef.current = true;
            setPixiReady(false);
            if (appRef.current) {
                try { appRef.current.destroy(true); } catch {}
            }
            appRef.current = null;
            worldRef.current = null;
            playerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!pixiReady || !worldRef.current || !overworldMap) return;

        const world = worldRef.current;
        const allBiomes = getAllBiomes();
        const colorMap: Record<string, string> = {};
        for (const b of allBiomes) colorMap[b.id] = b.color;

        const { width, height, cells } = overworldMap;

        if (!cells || cells.length === 0) return;

        const canvasW = containerRef.current?.clientWidth || 600;
        const canvasH = containerRef.current?.clientHeight || 600;
        const cellSize = Math.max(1, Math.floor(Math.min(canvasW / width, canvasH / height)));
        cellSizeRef.current = cellSize;
        mapDimsRef.current = { w: width, h: height };

        while (world.children.length > 0) {
            const child = world.children[0];
            if (child === playerRef.current) break;
            world.removeChildAt(0);
            child.destroy();
        }

        const grid = new Graphics();
        for (let i = 0; i < cells.length; i++) {
            const col = i % width;
            const row = Math.floor(i / width);
            const cell = cells[i] as { biome: string; isOcean: boolean; anchorName?: string | null };
            const color = cell.isOcean ? OCEAN_COLOR : (colorMap[cell.biome] || '#333333');
            grid.rect(col * cellSize, row * cellSize, cellSize, cellSize);
            grid.fill(color);

            if (cell.anchorName) {
                grid.rect(col * cellSize + cellSize * 0.2, row * cellSize + cellSize * 0.2, cellSize * 0.6, cellSize * 0.6);
                grid.fill({ color: '#ffffff', alpha: 0.6 });
            }
        }
        world.addChildAt(grid, 0);

        const scale = Math.min(
            (canvasW * 0.9) / (width * cellSize),
            (canvasH * 0.9) / (height * cellSize),
        );
        world.scale.set(scale);
        world.x = (canvasW - width * cellSize * scale) / 2;
        world.y = (canvasH - height * cellSize * scale) / 2;
    }, [overworldMap, pixiReady]);

    useEffect(() => {
        if (!playerRef.current || !worldRef.current || mapDimsRef.current.w === 0) return;
        const cs = cellSizeRef.current;
        const player = playerRef.current;
        player.clear();
        player.circle(playerPosition.x * cs + cs / 2, playerPosition.y * cs + cs / 2, cs * 0.45);
        player.fill('#ffd700', 0.8);
        player.circle(playerPosition.x * cs + cs / 2, playerPosition.y * cs + cs / 2, cs * 0.45);
        player.stroke({ color: '#ffffff', width: 2 });
    }, [playerPosition]);

    return (
        <div ref={containerRef} className="w-full h-full" />
    );
}