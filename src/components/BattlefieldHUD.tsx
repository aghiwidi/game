import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  Castle,
  Coins,
  Eye,
  EyeOff,
  Flame,
  Hammer,
  Home,
  Lock,
  LogOut,
  Mountain,
  Pause,
  Play,
  Shield,
  Swords,
  Trash2,
  TreePine,
  Unlock,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  Wheat,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AGE_ADVANCE_COST,
  AGE_NAMES,
  BUILDING_DEFS,
  FACTIONS,
  GRID_SIZE,
  UNIT_DEFS,
  canAfford,
  getBuildingCost,
  getUnitDisplayDef,
} from '../game/constants';
import { canPlaceBuildingAt, getPlayerPopStats, snapToGrid } from '../game/engine';
import {
  CameraState,
  PlacementPreview,
  SelectionBox,
  renderGameCanvas,
  renderMinimap,
} from '../game/renderer';
import { soundFX } from '../game/sound';
import {
  BuildingType,
  GameCommand,
  GameMode,
  GameState,
  PlayerId,
  UnitType,
} from '../game/types';

interface BattlefieldHUDProps {
  stateRef: React.MutableRefObject<GameState | null>;
  localPlayer: PlayerId;
  mode: GameMode;
  pingMs: number | null;
  onDispatchCommand: (cmd: GameCommand) => void;
  onExitMatch: () => void;
  onRematch: () => void;
}

const BUILD_CATEGORIES: { id: 'economy' | 'military' | 'fortress'; label: string }[] = [
  { id: 'fortress', label: 'Benteng' },
  { id: 'economy', label: 'Ekonomi' },
  { id: 'military', label: 'Militer' },
];

export const BattlefieldHUD: React.FC<BattlefieldHUDProps> = ({
  stateRef,
  localPlayer,
  mode,
  pingMs,
  onDispatchCommand,
  onExitMatch,
  onRematch,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Camera centered initially on local player's Town Center
  const camRef = useRef<CameraState>({
    x: localPlayer === 1 ? 380 : 2500,
    y: localPlayer === 1 ? 1800 : 360,
    zoom: 0.92,
  });

  const selectedUnitIdsRef = useRef<Set<string>>(new Set());
  const selectedBuildingIdRef = useRef<string | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const placementRef = useRef<PlacementPreview | null>(null);
  const wallDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const keysPressedRef = useRef<Set<string>>(new Set());
  const controlGroupsRef = useRef<Record<string, string[]>>({});
  const lastUnitClickRef = useRef<{ id: string; time: number } | null>(null);
  const minimapDraggingRef = useRef(false);

  // React UI snapshot state (updated at ~10Hz or on interaction so React stays fast)
  const [, setUiTick] = useState(0);
  const [buildCategory, setBuildCategory] = useState<'economy' | 'military' | 'fortress'>('fortress');
  const [placingType, setPlacingType] = useState<BuildingType | null>(null);
  const [muted, setMuted] = useState(soundFX.muted);
  const [revealAllFog, setRevealAllFog] = useState(false);

  const isOffline = mode === 'offline_ai';

  const forceUiSync = useCallback(() => setUiTick((t) => (t + 1) % 1000000), []);

  // Sync camera to local Town Center on mount
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const tc = s.buildings.find((b) => b.owner === localPlayer && b.type === 'town_center');
    if (tc) {
      camRef.current.x = tc.x;
      camRef.current.y = tc.y;
    }
  }, [localPlayer, stateRef]);

  // Periodic UI state refresh for smooth resource/timer/queue bars
  useEffect(() => {
    const id = window.setInterval(() => {
      setUiTick((t) => (t + 1) % 1000000);
    }, 120);
    return () => clearInterval(id);
  }, []);

  // Screen <-> World conversion
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0, sx: 0, sy: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cam = camRef.current;
    const wx = (sx - rect.width / 2) / cam.zoom + cam.x;
    const wy = (sy - rect.height / 2) / cam.zoom + cam.y;
    return { wx, wy, sx, sy };
  }, []);

  const clampCamera = useCallback(
    (cam: CameraState) => {
      const s = stateRef.current;
      if (!s) return;
      cam.x = Math.max(120, Math.min(s.mapWidth - 120, cam.x));
      cam.y = Math.max(120, Math.min(s.mapHeight - 120, cam.y));
      cam.zoom = Math.max(0.5, Math.min(1.5, cam.zoom));
    },
    [stateRef]
  );

  // Main Canvas Render & Camera Pan RAF Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const s = stateRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;

      if (s && canvas && container) {
        // Resize canvas crisp to container
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.floor(rect.width * dpr);
        const targetH = Math.floor(rect.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        // Keyboard WASD / Arrow camera pan
        const keys = keysPressedRef.current;
        const panSpeed = (680 / camRef.current.zoom) * dt;
        if (keys.has('w') || keys.has('arrowup')) camRef.current.y -= panSpeed;
        if (keys.has('s') || keys.has('arrowdown')) camRef.current.y += panSpeed;
        if (keys.has('a') || keys.has('arrowleft')) camRef.current.x -= panSpeed;
        if (keys.has('d') || keys.has('arrowright')) camRef.current.x += panSpeed;
        clampCamera(camRef.current);

        // Prune dead selections
        const aliveUnitIds = new Set(s.units.map((u) => u.id));
        for (const uid of selectedUnitIdsRef.current) {
          if (!aliveUnitIds.has(uid)) selectedUnitIdsRef.current.delete(uid);
        }
        if (
          selectedBuildingIdRef.current &&
          !s.buildings.some((b) => b.id === selectedBuildingIdRef.current)
        ) {
          selectedBuildingIdRef.current = null;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          renderGameCanvas(
            ctx,
            rect.width,
            rect.height,
            s,
            localPlayer,
            camRef.current,
            selectedUnitIdsRef.current,
            selectedBuildingIdRef.current,
            selectionBoxRef.current,
            placementRef.current,
            isOffline && revealAllFog
          );
          ctx.restore();
        }

        // Render Minimap
        const mini = minimapRef.current;
        if (mini) {
          const mctx = mini.getContext('2d');
          if (mctx) {
            renderMinimap(
              mctx,
              mini.width,
              mini.height,
              s,
              localPlayer,
              camRef.current,
              rect.width,
              rect.height,
              isOffline && revealAllFog
            );
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [clampCamera, isOffline, localPlayer, revealAllFog, stateRef]);

  // Keyboard Listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      keysPressedRef.current.add(k);

      if (k === 'escape') {
        setPlacingType(null);
        placementRef.current = null;
        wallDragStartRef.current = null;
        forceUiSync();
      } else if (k === ' ' && isOffline) {
        e.preventDefault();
        onDispatchCommand({ type: 'toggle_pause', playerId: localPlayer });
      } else if (k === 'home') {
        const s = stateRef.current;
        const tc = s?.buildings.find((b) => b.owner === localPlayer && b.type === 'town_center');
        if (tc) {
          camRef.current.x = tc.x;
          camRef.current.y = tc.y;
        }
      } else if (['1', '2', '3'].includes(k)) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          controlGroupsRef.current[k] = Array.from(selectedUnitIdsRef.current);
        } else if (controlGroupsRef.current[k]?.length) {
          const s = stateRef.current;
          if (!s) return;
          const valid = controlGroupsRef.current[k].filter((id) =>
            s.units.some((u) => u.id === id && u.owner === localPlayer)
          );
          if (valid.length > 0) {
            selectedUnitIdsRef.current = new Set(valid);
            selectedBuildingIdRef.current = null;
            forceUiSync();
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [forceUiSync, isOffline, localPlayer, onDispatchCommand, stateRef]);

  const startPlacement = (type: BuildingType) => {
    soundFX.playClick();
    setPlacingType(type);
    placementRef.current = { type, positions: [] };
    wallDragStartRef.current = null;
  };

  const computeWallLine = (
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): { x: number; y: number }[] => {
    const sx = snapToGrid(startX, 1);
    const sy = snapToGrid(startY, 1);
    const ex = snapToGrid(endX, 1);
    const ey = snapToGrid(endY, 1);
    const dx = ex - sx;
    const dy = ey - sy;
    const pts: { x: number; y: number }[] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      const steps = Math.min(18, Math.round(Math.abs(dx) / GRID_SIZE));
      const dir = dx >= 0 ? 1 : -1;
      for (let i = 0; i <= steps; i++) {
        pts.push({ x: sx + i * dir * GRID_SIZE, y: sy });
      }
    } else {
      const steps = Math.min(18, Math.round(Math.abs(dy) / GRID_SIZE));
      const dir = dy >= 0 ? 1 : -1;
      for (let i = 0; i <= steps; i++) {
        pts.push({ x: sx, y: sy + i * dir * GRID_SIZE });
      }
    }
    return pts;
  };

  // Mouse Handlers on Main Canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s) return;
    const { wx, wy, sx, sy } = screenToWorld(e.clientX, e.clientY);

    // Middle mouse or Alt+Left pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panningRef.current = { lastX: e.clientX, lastY: e.clientY };
      return;
    }

    // Right click: cancel placement OR issue contextual command
    if (e.button === 2) {
      if (placingType) {
        setPlacingType(null);
        placementRef.current = null;
        wallDragStartRef.current = null;
        return;
      }

      // Set rally point if own training building selected
      if (selectedBuildingIdRef.current) {
        const b = s.buildings.find((x) => x.id === selectedBuildingIdRef.current && x.owner === localPlayer);
        if (b && BUILDING_DEFS[b.type].trains) {
          soundFX.playCommand();
          onDispatchCommand({
            type: 'set_rally',
            playerId: localPlayer,
            buildingId: b.id,
            x: wx,
            y: wy,
          });
        }
        return;
      }

      const unitIds = Array.from(selectedUnitIdsRef.current);
      if (unitIds.length === 0) return;

      // Check enemy unit
      const enemyUnit = s.units.find(
        (u) => u.owner !== localPlayer && Math.hypot(u.x - wx, u.y - wy) <= 22
      );
      if (enemyUnit) {
        soundFX.playCommand();
        onDispatchCommand({ type: 'attack_unit', playerId: localPlayer, unitIds, targetUnitId: enemyUnit.id });
        return;
      }

      // Check enemy building
      const enemyBld = s.buildings.find(
        (b) =>
          b.owner !== localPlayer &&
          Math.abs(b.x - wx) <= BUILDING_DEFS[b.type].size + 6 &&
          Math.abs(b.y - wy) <= BUILDING_DEFS[b.type].size + 6
      );
      if (enemyBld) {
        soundFX.playCommand();
        onDispatchCommand({
          type: 'attack_building',
          playerId: localPlayer,
          unitIds,
          targetBuildingId: enemyBld.id,
        });
        return;
      }

      // Check friendly damaged/unfinished building for villagers
      const friendlyBld = s.buildings.find(
        (b) =>
          b.owner === localPlayer &&
          (!b.built || b.hp < b.maxHp) &&
          Math.abs(b.x - wx) <= BUILDING_DEFS[b.type].size + 6 &&
          Math.abs(b.y - wy) <= BUILDING_DEFS[b.type].size + 6
      );
      if (friendlyBld) {
        soundFX.playCommand();
        onDispatchCommand({
          type: 'repair_or_build',
          playerId: localPlayer,
          unitIds,
          buildingId: friendlyBld.id,
        });
        return;
      }

      // Check resource node
      const res = s.resources.find((r) => Math.hypot(r.x - wx, r.y - wy) <= r.radius + 10);
      if (res) {
        soundFX.playCommand();
        onDispatchCommand({ type: 'gather', playerId: localPlayer, unitIds, resourceId: res.id });
        return;
      }

      // Default: Move
      soundFX.playCommand();
      onDispatchCommand({ type: 'move', playerId: localPlayer, unitIds, x: wx, y: wy });
      return;
    }

    // Left Click
    if (e.button === 0) {
      if (placingType) {
        const def = BUILDING_DEFS[placingType];
        const px = snapToGrid(wx, def.gridSpan);
        const py = snapToGrid(wy, def.gridSpan);

        if (placingType === 'wall') {
          wallDragStartRef.current = { x: px, y: py };
          placementRef.current = { type: 'wall', positions: [{ x: px, y: py }] };
        } else {
          if (canPlaceBuildingAt(s, placingType, px, py)) {
            soundFX.playBuild();
            const builders = Array.from(selectedUnitIdsRef.current);
            onDispatchCommand({
              type: 'place_buildings',
              playerId: localPlayer,
              buildingType: placingType,
              positions: [{ x: px, y: py }],
              builderUnitIds: builders,
            });
            setPlacingType(null);
            placementRef.current = null;
          }
        }
        return;
      }

      // Start selection marquee box
      selectionBoxRef.current = { startX: sx, startY: sy, endX: sx, endY: sy };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s) return;

    if (panningRef.current) {
      const dx = (e.clientX - panningRef.current.lastX) / camRef.current.zoom;
      const dy = (e.clientY - panningRef.current.lastY) / camRef.current.zoom;
      camRef.current.x -= dx;
      camRef.current.y -= dy;
      clampCamera(camRef.current);
      panningRef.current = { lastX: e.clientX, lastY: e.clientY };
      return;
    }

    const { wx, wy, sx, sy } = screenToWorld(e.clientX, e.clientY);

    if (placingType) {
      if (placingType === 'wall' && wallDragStartRef.current) {
        const line = computeWallLine(wallDragStartRef.current.x, wallDragStartRef.current.y, wx, wy);
        placementRef.current = { type: 'wall', positions: line };
      } else {
        const span = BUILDING_DEFS[placingType].gridSpan;
        placementRef.current = {
          type: placingType,
          positions: [{ x: snapToGrid(wx, span), y: snapToGrid(wy, span) }],
        };
      }
      return;
    }

    if (selectionBoxRef.current) {
      selectionBoxRef.current.endX = sx;
      selectionBoxRef.current.endY = sy;
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panningRef.current) {
      panningRef.current = null;
      return;
    }

    const s = stateRef.current;
    if (!s) return;

    // Complete wall drag-placement
    if (e.button === 0 && placingType === 'wall' && wallDragStartRef.current && placementRef.current) {
      const validPositions = placementRef.current.positions.filter((pos) =>
        canPlaceBuildingAt(s, 'wall', pos.x, pos.y)
      );
      if (validPositions.length > 0) {
        soundFX.playBuild();
        onDispatchCommand({
          type: 'place_buildings',
          playerId: localPlayer,
          buildingType: 'wall',
          positions: validPositions,
          builderUnitIds: Array.from(selectedUnitIdsRef.current),
        });
      }
      wallDragStartRef.current = null;
      if (!e.shiftKey) {
        setPlacingType(null);
        placementRef.current = null;
      }
      return;
    }

    if (e.button === 0 && selectionBoxRef.current) {
      const box = selectionBoxRef.current;
      selectionBoxRef.current = null;

      const isDrag = Math.abs(box.endX - box.startX) > 8 || Math.abs(box.endY - box.startY) > 8;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();

      if (isDrag) {
        const p1 = screenToWorld(rect.left + Math.min(box.startX, box.endX), rect.top + Math.min(box.startY, box.endY));
        const p2 = screenToWorld(rect.left + Math.max(box.startX, box.endX), rect.top + Math.max(box.startY, box.endY));
        const matched = s.units.filter(
          (u) => u.owner === localPlayer && u.x >= p1.wx && u.x <= p2.wx && u.y >= p1.wy && u.y <= p2.wy
        );
        if (!e.shiftKey) selectedUnitIdsRef.current.clear();
        matched.forEach((u) => selectedUnitIdsRef.current.add(u.id));
        if (matched.length > 0) selectedBuildingIdRef.current = null;
        forceUiSync();
      } else {
        const { wx, wy } = screenToWorld(e.clientX, e.clientY);
        const clickedUnit = s.units.find(
          (u) => u.owner === localPlayer && Math.hypot(u.x - wx, u.y - wy) <= 20
        );
        if (clickedUnit) {
          const now = performance.now();
          if (
            lastUnitClickRef.current &&
            lastUnitClickRef.current.id === clickedUnit.id &&
            now - lastUnitClickRef.current.time < 340
          ) {
            // Double-click: select all allied units of same type nearby
            selectedUnitIdsRef.current.clear();
            s.units
              .filter(
                (u) =>
                  u.owner === localPlayer &&
                  u.type === clickedUnit.type &&
                  Math.hypot(u.x - clickedUnit.x, u.y - clickedUnit.y) < 550
              )
              .forEach((u) => selectedUnitIdsRef.current.add(u.id));
          } else {
            if (!e.shiftKey) selectedUnitIdsRef.current.clear();
            if (e.shiftKey && selectedUnitIdsRef.current.has(clickedUnit.id)) {
              selectedUnitIdsRef.current.delete(clickedUnit.id);
            } else {
              selectedUnitIdsRef.current.add(clickedUnit.id);
            }
          }
          lastUnitClickRef.current = { id: clickedUnit.id, time: now };
          selectedBuildingIdRef.current = null;
          forceUiSync();
          return;
        }

        const clickedBuilding = s.buildings.find(
          (b) =>
            b.owner === localPlayer &&
            Math.abs(b.x - wx) <= BUILDING_DEFS[b.type].size + 4 &&
            Math.abs(b.y - wy) <= BUILDING_DEFS[b.type].size + 4
        );
        if (clickedBuilding) {
          selectedUnitIdsRef.current.clear();
          selectedBuildingIdRef.current = clickedBuilding.id;
          soundFX.playClick();
          forceUiSync();
          return;
        }

        if (!e.shiftKey) {
          selectedUnitIdsRef.current.clear();
          selectedBuildingIdRef.current = null;
          forceUiSync();
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    camRef.current.zoom = Math.max(0.5, Math.min(1.5, camRef.current.zoom + delta));
  };

  const panFromMinimap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mini = minimapRef.current;
    const s = stateRef.current;
    if (!mini || !s) return;
    const rect = mini.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    camRef.current.x = nx * s.mapWidth;
    camRef.current.y = ny * s.mapHeight;
    clampCamera(camRef.current);
  };

  const jumpToIdleVillager = () => {
    const s = stateRef.current;
    if (!s) return;
    const idles = s.units.filter((u) => u.owner === localPlayer && u.type === 'villager' && u.state === 'idle');
    if (idles.length === 0) return;
    const target = idles[0];
    camRef.current.x = target.x;
    camRef.current.y = target.y;
    selectedUnitIdsRef.current = new Set([target.id]);
    selectedBuildingIdRef.current = null;
    soundFX.playClick();
    forceUiSync();
  };

  const selectAllMilitary = () => {
    const s = stateRef.current;
    if (!s) return;
    const mil = s.units.filter((u) => u.owner === localPlayer && u.type !== 'villager');
    if (mil.length === 0) return;
    selectedUnitIdsRef.current = new Set(mil.map((u) => u.id));
    selectedBuildingIdRef.current = null;
    soundFX.playClick();
    forceUiSync();
  };

  const state = stateRef.current;
  if (!state) return null;

  const p = state.players[localPlayer];
  const enemy = state.players[localPlayer === 1 ? 2 : 1];
  const pop = getPlayerPopStats(state, localPlayer);
  const idleVillagersCount = state.units.filter(
    (u) => u.owner === localPlayer && u.type === 'villager' && u.state === 'idle'
  ).length;
  const militaryCount = state.units.filter(
    (u) => u.owner === localPlayer && u.type !== 'villager'
  ).length;

  const selectedUnits = state.units.filter((u) => selectedUnitIdsRef.current.has(u.id));
  const selectedBuilding = selectedBuildingIdRef.current
    ? state.buildings.find((b) => b.id === selectedBuildingIdRef.current) || null
    : null;

  const hasVillagerSelected = selectedUnits.some((u) => u.type === 'villager');
  const nextAge = p.age < 3 ? ((p.age + 1) as 2 | 3) : null;
  const nextAgeCost = nextAge ? AGE_ADVANCE_COST[nextAge] : null;
  const canAdvanceAge = Boolean(nextAge && !p.ageAdvancing && nextAgeCost && canAfford(p.resources, nextAgeCost));

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeAlert = localPlayer === 1 ? state.lastAlertP1 : state.lastAlertP2;
  const showAlert = activeAlert && state.elapsed - activeAlert.time < 5.5;

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0F1218] text-[#F1EDE4] overflow-hidden select-none">
      {/* TOP RESOURCE & KINGDOM HUD BAR */}
      <header className="h-12 px-4 bg-[#141820] border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
        {/* Resources */}
        <div className="flex items-center gap-4 text-xs font-mono-num">
          <div className="flex items-center gap-1.5" title="Kayu">
            <TreePine className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-400 hidden sm:inline">Kayu</span>
            <span className="font-bold text-white">{Math.floor(p.resources.wood)}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Pangan">
            <Wheat className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-slate-400 hidden sm:inline">Pangan</span>
            <span className="font-bold text-white">{Math.floor(p.resources.food)}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Emas">
            <Coins className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-slate-400 hidden sm:inline">Emas</span>
            <span className="font-bold text-white">{Math.floor(p.resources.gold)}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Batu (Benteng)">
            <Mountain className="w-4 h-4 text-slate-300 shrink-0" />
            <span className="text-slate-400 hidden sm:inline">Batu</span>
            <span className="font-bold text-white">{Math.floor(p.resources.stone)}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5" title="Populasi">
            <Users className="w-4 h-4 text-sky-400 shrink-0" />
            <span className={pop.used >= pop.cap ? 'text-amber-400 font-bold' : 'text-white font-bold'}>
              {pop.used}/{pop.cap}
            </span>
          </div>
        </div>

        {/* Center: Age & Upgrade */}
        <div className="hidden lg:flex items-center gap-3">
          <span className="font-display text-xs font-bold text-amber-200 whitespace-nowrap">
            {FACTIONS[p.faction].name} · {AGE_NAMES[p.age]}
          </span>
          {p.ageAdvancing ? (
            <div className="px-3 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-xs font-mono-num text-amber-200 whitespace-nowrap">
              Menuju {AGE_NAMES[p.ageAdvancing.targetAge]} ({Math.ceil(p.ageAdvancing.remaining)}d)
            </div>
          ) : (
            nextAge &&
            nextAgeCost && (
              <button
                type="button"
                disabled={!canAdvanceAge}
                onClick={() => {
                  soundFX.playClick();
                  onDispatchCommand({ type: 'advance_age', playerId: localPlayer });
                }}
                title={`Biaya: ${nextAgeCost.food} Pangan, ${nextAgeCost.gold} Emas`}
                className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 disabled:bg-white/5 disabled:text-slate-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" />
                <span>
                  Naik {AGE_NAMES[nextAge]} ({nextAgeCost.food}P / {nextAgeCost.gold}E)
                </span>
              </button>
            )
          )}
        </div>

        {/* Right: Quick Utilities, Timer, Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {idleVillagersCount > 0 && (
            <button
              type="button"
              onClick={jumpToIdleVillager}
              className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-200 flex items-center gap-1.5 whitespace-nowrap"
              title="Lompat ke Warga yang menganggur"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span className="font-mono-num">Menganggur: {idleVillagersCount}</span>
            </button>
          )}

          {militaryCount > 0 && (
            <button
              type="button"
              onClick={selectAllMilitary}
              className="hidden sm:flex px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 items-center gap-1.5 whitespace-nowrap"
              title="Pilih seluruh pasukan tempur"
            >
              <Swords className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-mono-num">Pasukan: {militaryCount}</span>
            </button>
          )}

          {pingMs !== null && !isOffline && (
            <span className="text-xs font-mono-num text-emerald-400 px-2 whitespace-nowrap">
              Ping {pingMs} ms
            </span>
          )}

          <span className="text-xs font-mono-num text-slate-300 px-1.5 whitespace-nowrap">
            {formatTime(state.elapsed)}
          </span>

          {isOffline && (
            <>
              <button
                type="button"
                onClick={() => {
                  const nextSpeed = state.speed === 1 ? 1.5 : state.speed === 1.5 ? 2 : 1;
                  onDispatchCommand({ type: 'set_speed', playerId: localPlayer, speed: nextSpeed });
                }}
                className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs font-mono-num text-slate-200 whitespace-nowrap"
                title="Kecepatan Game"
              >
                {state.speed}x
              </button>
              <button
                type="button"
                onClick={() => onDispatchCommand({ type: 'toggle_pause', playerId: localPlayer })}
                className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-slate-200"
                title={state.paused ? 'Lanjutkan (Spasi)' : 'Jeda (Spasi)'}
              >
                {state.paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setRevealAllFog((v) => !v)}
                className={`p-1.5 rounded-md ${revealAllFog ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                title="Buka/Tutup Kabut Peta (Mode Latihan)"
              >
                {revealAllFog ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              soundFX.muted = !soundFX.muted;
              setMuted(soundFX.muted);
            }}
            className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-slate-300"
            title={muted ? 'Nyalakan Suara' : 'Bisukan Suara'}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onExitMatch}
            className="px-2.5 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      {/* MAIN PLAYABLE CANVAS VIEWPORT */}
      <div ref={containerRef} className="relative flex-1 min-h-0 w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className={`w-full h-full block ${placingType ? 'cursor-crosshair' : 'cursor-default'}`}
        />

        {/* Floating Zoom & Home TC Quick Buttons (top-right inside canvas, unobtrusive) */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              const tc = state.buildings.find((b) => b.owner === localPlayer && b.type === 'town_center');
              if (tc) {
                camRef.current.x = tc.x;
                camRef.current.y = tc.y;
              }
            }}
            className="p-2 rounded-lg bg-[#141820]/90 hover:bg-[#1E2530] border border-white/10 text-amber-300"
            title="Kembali ke Balai Kota (Home)"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              camRef.current.zoom = Math.min(1.5, camRef.current.zoom + 0.14);
            }}
            className="p-2 rounded-lg bg-[#141820]/90 hover:bg-[#1E2530] border border-white/10 text-slate-200"
            title="Perbesar"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              camRef.current.zoom = Math.max(0.5, camRef.current.zoom - 0.14);
            }}
            className="p-2 rounded-lg bg-[#141820]/90 hover:bg-[#1E2530] border border-white/10 text-slate-200"
            title="Perkecil"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>

        {/* Live Battle / Age Alert Banner */}
        {showAlert && activeAlert && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-[#141820]/95 border border-amber-500/40 text-xs font-semibold text-amber-200 pointer-events-none">
            {activeAlert.text}
          </div>
        )}

        {/* Placement Mode Hint Banner */}
        {placingType && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-[#141820]/95 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-3">
            <span>
              Menempatkan <strong>{BUILDING_DEFS[placingType].name}</strong>
              {placingType === 'wall' ? ' — Klik & seret untuk bangun barisan tembok' : ' — Klik kiri untuk bangun'}
            </span>
            <button
              type="button"
              onClick={() => {
                setPlacingType(null);
                placementRef.current = null;
                wallDragStartRef.current = null;
              }}
              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white font-medium"
            >
              Batal (Esc)
            </button>
          </div>
        )}

        {/* Pause Overlay */}
        {state.paused && !state.winner && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
            <div className="bg-[#151A22] border border-white/12 rounded-2xl px-8 py-6 text-center space-y-4">
              <h2 className="font-display text-2xl font-bold text-amber-200">Pertempuran Dijeda</h2>
              <button
                type="button"
                onClick={() => onDispatchCommand({ type: 'toggle_pause', playerId: localPlayer })}
                className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-sm font-semibold text-white"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM COMMAND DOCK (AOE-STYLE) */}
      <footer className="h-[196px] bg-[#141820] border-t border-white/10 px-4 py-2.5 grid grid-cols-12 gap-4 shrink-0">
        {/* Left/Center Command Area (9 cols on desktop) */}
        <div className="col-span-12 md:col-span-9 flex gap-4 min-w-0 h-full overflow-hidden">
          {/* Context Selection Summary */}
          <div className="w-56 shrink-0 bg-[#0F1218] border border-white/8 rounded-xl p-3 flex flex-col justify-between">
            {selectedBuilding ? (
              <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-amber-200 truncate">
                      {BUILDING_DEFS[selectedBuilding.type].name}
                    </span>
                    <span className="text-[11px] font-mono-num text-slate-400">
                      {Math.ceil(selectedBuilding.hp)}/{selectedBuilding.maxHp}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.max(0, Math.min(100, (selectedBuilding.hp / selectedBuilding.maxHp) * 100))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 pt-1">
                    {selectedBuilding.built
                      ? BUILDING_DEFS[selectedBuilding.type].shortDesc
                      : `Dalam pembangunan (${Math.round(selectedBuilding.buildProgress * 100)}%)`}
                  </p>
                </div>

                {/* Active Queue or Gate/Demolish Controls */}
                <div className="space-y-1.5">
                  {selectedBuilding.queue.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {selectedBuilding.queue.map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            onDispatchCommand({
                              type: 'cancel_train',
                              playerId: localPlayer,
                              buildingId: selectedBuilding.id,
                              index: idx,
                            })
                          }
                          title="Klik untuk batalkan pelatihan"
                          className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono-num text-amber-200 hover:bg-red-500/30"
                        >
                          {getUnitDisplayDef(q.unitType, p.faction).name.split(' ')[0]} {Math.ceil(q.remaining)}d
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    {selectedBuilding.type === 'gate' && selectedBuilding.built && (
                      <button
                        type="button"
                        onClick={() =>
                          onDispatchCommand({
                            type: 'toggle_gate',
                            playerId: localPlayer,
                            buildingId: selectedBuilding.id,
                          })
                        }
                        className="flex-1 py-1.5 px-2 rounded bg-white/8 hover:bg-white/15 text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1"
                      >
                        {selectedBuilding.gateLocked ? <Lock className="w-3 h-3 text-red-400" /> : <Unlock className="w-3 h-3 text-emerald-400" />}
                        <span>{selectedBuilding.gateLocked ? 'Terkunci' : 'Terbuka'}</span>
                      </button>
                    )}

                    {!(
                      selectedBuilding.type === 'town_center' &&
                      state.buildings.filter((b) => b.owner === localPlayer && b.type === 'town_center').length <= 1
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          onDispatchCommand({
                            type: 'demolish_building',
                            playerId: localPlayer,
                            buildingId: selectedBuilding.id,
                          });
                          selectedBuildingIdRef.current = null;
                          forceUiSync();
                        }}
                        className="py-1.5 px-2.5 rounded bg-red-500/15 hover:bg-red-500/30 text-[11px] font-medium text-red-200 flex items-center gap-1"
                        title="Hancurkan bangunan (kembali 40% biaya)"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Runtuhkan</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : selectedUnits.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-200">
                      {selectedUnits.length === 1
                        ? getUnitDisplayDef(selectedUnits[0].type, p.faction).name
                        : `${selectedUnits.length} Pasukan Terpilih`}
                    </span>
                  </div>
                  {selectedUnits.length === 1 ? (
                    <div className="text-[11px] text-slate-300 space-y-0.5 font-mono-num">
                      <div>
                        HP: {Math.ceil(selectedUnits[0].hp)}/{selectedUnits[0].maxHp}
                      </div>
                      <div>
                        Serang: {getUnitDisplayDef(selectedUnits[0].type, p.faction).attack + p.attackUpgrade * 2} · Zirah:{' '}
                        {getUnitDisplayDef(selectedUnits[0].type, p.faction).armor + p.armorUpgrade * 2}
                      </div>
                      <div className="font-sans text-slate-400 pt-0.5">
                        {getUnitDisplayDef(selectedUnits[0].type, p.faction).shortDesc}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 leading-relaxed">
                      Klik kanan tanah untuk bergerak, atau klik kanan musuh/benteng untuk menyerang.
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onDispatchCommand({
                        type: 'set_stance',
                        playerId: localPlayer,
                        unitIds: selectedUnits.map((u) => u.id),
                        stance: 'aggressive',
                      })
                    }
                    className={`flex-1 py-1 px-2 rounded text-[11px] font-medium border ${
                      selectedUnits[0].stance === 'aggressive'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                        : 'bg-white/5 border-white/10 text-slate-400'
                    }`}
                  >
                    Agresif
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onDispatchCommand({
                        type: 'set_stance',
                        playerId: localPlayer,
                        unitIds: selectedUnits.map((u) => u.id),
                        stance: 'stand',
                      })
                    }
                    className={`flex-1 py-1 px-2 rounded text-[11px] font-medium border ${
                      selectedUnits[0].stance === 'stand'
                        ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                        : 'bg-white/5 border-white/10 text-slate-400'
                    }`}
                  >
                    Siaga
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
                  <Hammer className="w-3.5 h-3.5" />
                  <span>Konstruksi & Komando</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Klik bangunan di kanan untuk membangun (Warga terdekat akan otomatis bekerja), atau klik Balai Kota / Barak untuk melatih pasukan.
                </p>
                <div className="text-[10px] text-slate-500 pt-1">
                  WASD: Geser Peta · Seret: Pilih · Klik Kanan: Perintah
                </div>
              </div>
            )}
          </div>

          {/* Right side of Command Dock: Training Buttons OR Building Palette */}
          <div className="flex-1 bg-[#0F1218] border border-white/8 rounded-xl p-2.5 flex flex-col gap-2 min-w-0 overflow-hidden">
            {selectedBuilding && selectedBuilding.built && (BUILDING_DEFS[selectedBuilding.type].trains || selectedBuilding.type === 'blacksmith') ? (
              <div className="flex flex-col gap-2 h-full">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    {selectedBuilding.type === 'blacksmith' ? 'Riset Teknologi Pandai Besi' : 'Latih Pasukan & Warga'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Klik kanan di peta untuk ubah titik kumpul
                  </span>
                </div>

                {selectedBuilding.type === 'blacksmith' ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={
                        p.attackUpgrade >= 2 ||
                        !canAfford(p.resources, {
                          food: 120 + p.attackUpgrade * 90,
                          gold: 80 + p.attackUpgrade * 80,
                        })
                      }
                      onClick={() => {
                        soundFX.playClick();
                        onDispatchCommand({ type: 'upgrade_tech', playerId: localPlayer, tech: 'attack' });
                      }}
                      className="p-2.5 rounded-lg bg-[#181E29] hover:bg-[#202837] disabled:opacity-45 border border-white/10 text-left space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-amber-200">
                        <span className="flex items-center gap-1.5">
                          <Flame className="w-3.5 h-3.5 text-orange-400" />
                          Tempa Senjata (+2 Serang)
                        </span>
                        <span className="font-mono-num text-[11px]">Lv {p.attackUpgrade}/2</span>
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-400">
                        {p.attackUpgrade >= 2
                          ? 'Maksimal'
                          : `${120 + p.attackUpgrade * 90} Pangan · ${80 + p.attackUpgrade * 80} Emas`}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={
                        p.armorUpgrade >= 2 ||
                        !canAfford(p.resources, {
                          food: 120 + p.armorUpgrade * 90,
                          gold: 80 + p.armorUpgrade * 80,
                        })
                      }
                      onClick={() => {
                        soundFX.playClick();
                        onDispatchCommand({ type: 'upgrade_tech', playerId: localPlayer, tech: 'armor' });
                      }}
                      className="p-2.5 rounded-lg bg-[#181E29] hover:bg-[#202837] disabled:opacity-45 border border-white/10 text-left space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-amber-200">
                        <span className="flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-sky-400" />
                          Tempa Zirah (+2 Armor)
                        </span>
                        <span className="font-mono-num text-[11px]">Lv {p.armorUpgrade}/2</span>
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-400">
                        {p.armorUpgrade >= 2
                          ? 'Maksimal'
                          : `${120 + p.armorUpgrade * 90} Pangan · ${80 + p.armorUpgrade * 80} Emas`}
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto">
                    {BUILDING_DEFS[selectedBuilding.type].trains?.map((ut: UnitType) => {
                      const uDef = getUnitDisplayDef(ut, p.faction);
                      const locked = p.age < uDef.minAge;
                      const affordable = canAfford(p.resources, uDef.cost) && pop.used < pop.cap;
                      return (
                        <button
                          key={ut}
                          type="button"
                          disabled={locked || !affordable}
                          onClick={() => {
                            soundFX.playClick();
                            onDispatchCommand({
                              type: 'train_unit',
                              playerId: localPlayer,
                              buildingId: selectedBuilding.id,
                              unitType: ut,
                            });
                          }}
                          className="p-2 rounded-lg bg-[#181E29] hover:bg-[#202837] disabled:opacity-45 border border-white/10 text-left flex flex-col justify-between gap-1"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold text-white truncate">{uDef.name}</span>
                            {locked && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                          </div>
                          <div className="text-[10px] text-slate-400 line-clamp-1">{uDef.shortDesc}</div>
                          <div className="text-[10px] font-mono-num text-amber-300">
                            {locked
                              ? `Perlu ${AGE_NAMES[uDef.minAge]}`
                              : [
                                  uDef.cost.food ? `${uDef.cost.food}P` : '',
                                  uDef.cost.wood ? `${uDef.cost.wood}K` : '',
                                  uDef.cost.gold ? `${uDef.cost.gold}E` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                          </div>
                        </button>
                      );
                    })}
                    {selectedBuilding.type === 'town_center' && nextAge && nextAgeCost && (
                      <button
                        type="button"
                        disabled={!canAdvanceAge}
                        onClick={() => {
                          soundFX.playClick();
                          onDispatchCommand({ type: 'advance_age', playerId: localPlayer });
                        }}
                        className="p-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/35 disabled:opacity-45 border border-amber-500/40 text-left flex flex-col justify-between gap-1"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-amber-200 truncate">
                            {p.ageAdvancing ? `Menuju ${AGE_NAMES[nextAge]}...` : `Naik ${AGE_NAMES[nextAge]}`}
                          </span>
                          <ArrowUpCircle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                        </div>
                        <div className="text-[10px] text-slate-300 line-clamp-1">
                          Buka benteng & pasukan zaman baru
                        </div>
                        <div className="text-[10px] font-mono-num text-amber-300">
                          {p.ageAdvancing
                            ? `${Math.ceil(p.ageAdvancing.remaining)} detik`
                            : `${nextAgeCost.food}P · ${nextAgeCost.gold}E`}
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Building Construction Palette (always visible when idle or villagers selected) */
              <div className="flex flex-col gap-2 h-full">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#161B24] border border-white/8">
                    {BUILD_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setBuildCategory(cat.id)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                          buildCategory === cat.id
                            ? 'bg-amber-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400 hidden sm:inline truncate">
                    {hasVillagerSelected
                      ? 'Warga siap membangun pilihan Anda'
                      : 'Pilih bangunan untuk menugaskan Warga'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 overflow-y-auto pr-1">
                  {(Object.keys(BUILDING_DEFS) as BuildingType[])
                    .filter((bt) => BUILDING_DEFS[bt].category === buildCategory)
                    .map((bt) => {
                      const def = BUILDING_DEFS[bt];
                      const cost = getBuildingCost(bt, p.faction);
                      const locked = p.age < def.minAge;
                      const affordable = canAfford(p.resources, cost);
                      const isPlacing = placingType === bt;
                      return (
                        <button
                          key={bt}
                          type="button"
                          disabled={locked || !affordable}
                          onClick={() => startPlacement(bt)}
                          title={def.shortDesc}
                          className={`p-2 rounded-lg border text-left flex flex-col justify-between gap-1 transition-colors ${
                            isPlacing
                              ? 'bg-emerald-600/25 border-emerald-400'
                              : 'bg-[#181E29] hover:bg-[#202837] disabled:opacity-40 border-white/10'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold text-amber-100 truncate">
                              {def.name}
                            </span>
                            {locked && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                          </div>
                          <div className="text-[10px] text-slate-400 line-clamp-1">{def.shortDesc}</div>
                          <div className="text-[10px] font-mono-num text-amber-300">
                            {locked
                              ? `Perlu ${AGE_NAMES[def.minAge]}`
                              : [
                                  cost.wood ? `${cost.wood}K` : '',
                                  cost.stone ? `${cost.stone}B` : '',
                                  cost.gold ? `${cost.gold}E` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Interactive Minimap */}
        <div className="hidden md:flex col-span-3 flex-col items-end justify-center">
          <div className="relative rounded-xl overflow-hidden border border-amber-500/30 bg-[#0D1318]">
            <canvas
              ref={minimapRef}
              width={224}
              height={168}
              onMouseDown={(e) => {
                minimapDraggingRef.current = true;
                panFromMinimap(e);
              }}
              onMouseMove={(e) => {
                if (minimapDraggingRef.current) panFromMinimap(e);
              }}
              onMouseUp={() => {
                minimapDraggingRef.current = false;
              }}
              onMouseLeave={() => {
                minimapDraggingRef.current = false;
              }}
              className="block cursor-pointer w-[224px] h-[168px]"
            />
          </div>
        </div>
      </footer>

      {/* VICTORY / DEFEAT MODAL */}
      {state.winner && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#151A22] border border-amber-500/40 rounded-2xl p-6 text-center space-y-5">
            <div className="space-y-2">
              <div className="inline-flex p-3 rounded-xl bg-amber-500/15 text-amber-400">
                {state.winner === localPlayer ? <Castle className="w-8 h-8" /> : <Shield className="w-8 h-8 text-red-400" />}
              </div>
              <h2 className="font-display text-2xl font-bold text-white">
                {state.winner === localPlayer ? 'Kemenangan Agung!' : 'Kerajaan Takluk'}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">{state.winReason}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left bg-[#0E1117] border border-white/8 rounded-xl p-4 text-xs">
              <div>
                <div className="text-slate-400">Durasi Pertempuran</div>
                <div className="font-mono-num font-bold text-white text-sm">{formatTime(state.elapsed)}</div>
              </div>
              <div>
                <div className="text-slate-400">Skor Kerajaan</div>
                <div className="font-mono-num font-bold text-amber-300 text-sm">{p.score}</div>
              </div>
              <div>
                <div className="text-slate-400">Pasukan Lawan Gugur</div>
                <div className="font-mono-num font-bold text-white text-sm">{p.unitsKilled}</div>
              </div>
              <div>
                <div className="text-slate-400">Benteng Lawan Hancur</div>
                <div className="font-mono-num font-bold text-white text-sm">{p.buildingsDestroyed}</div>
              </div>
              <div className="col-span-2 pt-1 border-t border-white/8 flex items-center justify-between">
                <span className="text-slate-400">Lawan ({enemy.name})</span>
                <span className="font-mono-num text-slate-300">Skor: {enemy.score}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onExitMatch}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-semibold text-slate-200 whitespace-nowrap"
              >
                Kembali ke Lobi
              </button>
              {isOffline && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white whitespace-nowrap"
                >
                  Main Lagi
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
