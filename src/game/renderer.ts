import { BUILDING_DEFS, FACTIONS, FOG_CELL, GRID_SIZE, getUnitDisplayDef } from './constants';
import { canPlaceBuildingAt } from './engine';
import { Building, BuildingType, GameState, PlayerId, ResourceNode, Unit } from './types';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface PlacementPreview {
  type: BuildingType;
  positions: { x: number; y: number }[];
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function isPointVisibleToPlayer(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  const fog = playerId === 1 ? state.fogP1 : state.fogP2;
  const gx = Math.max(0, Math.min(state.fogCols - 1, Math.floor(x / FOG_CELL)));
  const gy = Math.max(0, Math.min(state.fogRows - 1, Math.floor(y / FOG_CELL)));
  return fog[gy * state.fogCols + gx] === 2;
}

export function isPointExploredByPlayer(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  const fog = playerId === 1 ? state.fogP1 : state.fogP2;
  const gx = Math.max(0, Math.min(state.fogCols - 1, Math.floor(x / FOG_CELL)));
  const gy = Math.max(0, Math.min(state.fogRows - 1, Math.floor(y / FOG_CELL)));
  return fog[gy * state.fogCols + gx] >= 1;
}

export function renderGameCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  localPlayer: PlayerId,
  cam: CameraState,
  selectedUnitIds: Set<string>,
  selectedBuildingId: string | null,
  selectionBox: SelectionBox | null,
  placement: PlacementPreview | null,
  revealAllFog: boolean
): void {
  ctx.save();
  ctx.fillStyle = '#0D1318';
  ctx.fillRect(0, 0, width, height);

  // Camera transform
  ctx.translate(width / 2, height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const viewLeft = cam.x - width / (2 * cam.zoom) - 120;
  const viewRight = cam.x + width / (2 * cam.zoom) + 120;
  const viewTop = cam.y - height / (2 * cam.zoom) - 120;
  const viewBottom = cam.y + height / (2 * cam.zoom) + 120;

  // 1. Ground Terrain Base
  const bgColor =
    state.mapStyle === 'highland' ? '#364928' : state.mapStyle === 'river' ? '#2B4A2B' : '#315129';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, state.mapWidth, state.mapHeight);

  // Subtle tactical terrain grass patches & grid lines when placing buildings
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  const startTileX = Math.max(0, Math.floor(viewLeft / (GRID_SIZE * 2)) * (GRID_SIZE * 2));
  const startTileY = Math.max(0, Math.floor(viewTop / (GRID_SIZE * 2)) * (GRID_SIZE * 2));
  for (let gx = startTileX; gx < Math.min(state.mapWidth, viewRight); gx += GRID_SIZE * 2) {
    for (let gy = startTileY; gy < Math.min(state.mapHeight, viewBottom); gy += GRID_SIZE * 2) {
      if (((gx + gy) / (GRID_SIZE * 2)) % 2 === 0) {
        ctx.fillRect(gx, gy, GRID_SIZE * 2, GRID_SIZE * 2);
      }
    }
  }

  // Terrain features (water, bridge, highland plateau, roads)
  for (const t of state.terrain) {
    if (t.kind === 'water') {
      const grad = ctx.createLinearGradient(t.x, 0, t.x + t.w, 0);
      grad.addColorStop(0, '#1B4965');
      grad.addColorStop(0.5, '#246A92');
      grad.addColorStop(1, '#1B4965');
      ctx.fillStyle = grad;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      // Shore sand border
      ctx.fillStyle = 'rgba(194, 178, 128, 0.35)';
      ctx.fillRect(t.x - 8, t.y, 8, t.h);
      ctx.fillRect(t.x + t.w, t.y, 8, t.h);
      // Water ripples
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.18)';
      ctx.lineWidth = 2;
      const offset = (state.elapsed * 22) % 60;
      for (let ry = 40 + offset; ry < t.h; ry += 60) {
        ctx.beginPath();
        ctx.moveTo(t.x + 24, t.y + ry);
        ctx.lineTo(t.x + t.w - 24, t.y + ry + 6);
        ctx.stroke();
      }
    } else if (t.kind === 'bridge') {
      ctx.fillStyle = '#78716C';
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeStyle = '#44403C';
      ctx.lineWidth = 4;
      ctx.strokeRect(t.x, t.y, t.w, t.h);
      // Stone bridge planks
      ctx.strokeStyle = 'rgba(28, 25, 23, 0.35)';
      ctx.lineWidth = 2;
      for (let bx = t.x + 18; bx < t.x + t.w; bx += 22) {
        ctx.beginPath();
        ctx.moveTo(bx, t.y + 4);
        ctx.lineTo(bx, t.y + t.h - 4);
        ctx.stroke();
      }
    } else if (t.kind === 'highland') {
      ctx.fillStyle = '#435531';
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeStyle = 'rgba(214, 211, 209, 0.2)';
      ctx.lineWidth = 4;
      ctx.strokeRect(t.x, t.y, t.w, t.h);
    } else if (t.kind === 'road') {
      ctx.fillStyle = 'rgba(168, 138, 92, 0.35)';
      ctx.fillRect(t.x, t.y, t.w, t.h);
    }
  }

  // Placement grid guide
  if (placement) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const gx0 = Math.max(0, Math.floor(viewLeft / GRID_SIZE) * GRID_SIZE);
    const gy0 = Math.max(0, Math.floor(viewTop / GRID_SIZE) * GRID_SIZE);
    for (let x = gx0; x <= Math.min(state.mapWidth, viewRight); x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, viewTop));
      ctx.lineTo(x, Math.min(state.mapHeight, viewBottom));
      ctx.stroke();
    }
    for (let y = gy0; y <= Math.min(state.mapHeight, viewBottom); y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, viewLeft), y);
      ctx.lineTo(Math.min(state.mapWidth, viewRight), y);
      ctx.stroke();
    }
  }

  // Map outer border
  ctx.strokeStyle = '#92400E';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, state.mapWidth - 8, state.mapHeight - 8);

  // 2. Resource Nodes (visible if explored)
  for (const res of state.resources) {
    if (res.x < viewLeft || res.x > viewRight || res.y < viewTop || res.y > viewBottom) continue;
    if (!revealAllFog && !isPointExploredByPlayer(state, localPlayer, res.x, res.y)) continue;
    drawResourceNode(ctx, res);
  }

  // 3. Farms first (ground-level buildings)
  const wallSet = new Set<string>();
  for (const b of state.buildings) {
    if (b.type === 'wall' || b.type === 'gate') {
      wallSet.add(`${b.owner}_${Math.round(b.x / GRID_SIZE)}_${Math.round(b.y / GRID_SIZE)}`);
    }
  }

  for (const b of state.buildings) {
    if (b.type !== 'farm') continue;
    if (b.x < viewLeft || b.x > viewRight || b.y < viewTop || b.y > viewBottom) continue;
    if (b.owner !== localPlayer && !revealAllFog && !isPointExploredByPlayer(state, localPlayer, b.x, b.y)) continue;
    drawBuilding(ctx, state, b, b.id === selectedBuildingId, wallSet, localPlayer);
  }

  // 4. Other Buildings (sorted by Y for depth)
  const sortedBuildings = state.buildings
    .filter((b) => b.type !== 'farm')
    .sort((a, b) => a.y - b.y);

  for (const b of sortedBuildings) {
    if (b.x < viewLeft || b.x > viewRight || b.y < viewTop || b.y > viewBottom) continue;
    if (b.owner !== localPlayer && !revealAllFog && !isPointExploredByPlayer(state, localPlayer, b.x, b.y)) continue;
    drawBuilding(ctx, state, b, b.id === selectedBuildingId, wallSet, localPlayer);
  }

  // Rally point line for selected owned building
  if (selectedBuildingId) {
    const selB = state.buildings.find((b) => b.id === selectedBuildingId && b.owner === localPlayer);
    if (selB && BUILDING_DEFS[selB.type].trains) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(selB.x, selB.y);
      ctx.lineTo(selB.rallyX, selB.rallyY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath();
      ctx.arc(selB.rallyX, selB.rallyY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 5. Units (sorted by Y)
  const sortedUnits = [...state.units].sort((a, b) => a.y - b.y);
  for (const u of sortedUnits) {
    if (u.x < viewLeft || u.x > viewRight || u.y < viewTop || u.y > viewBottom) continue;
    if (u.owner !== localPlayer && !revealAllFog && !isPointVisibleToPlayer(state, localPlayer, u.x, u.y)) {
      continue;
    }
    drawUnit(ctx, state, u, selectedUnitIds.has(u.id));
  }

  // 6. Projectiles
  for (const p of state.projectiles) {
    if (p.kind === 'boulder') {
      const arc = Math.sin(p.progress * Math.PI) * 58;
      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Boulder
      ctx.fillStyle = '#9CA3AF';
      ctx.beginPath();
      ctx.arc(p.x, p.y - arc, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      const arc = Math.sin(p.progress * Math.PI) * 22;
      const angle = Math.atan2(p.targetY - p.startY, p.targetX - p.startX);
      ctx.save();
      ctx.translate(p.x, p.y - arc);
      ctx.rotate(angle);
      ctx.strokeStyle = '#FEF3C7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(5, -1.5, 4, 3);
      ctx.restore();
    }
  }

  // 7. Visual Effects (markers, slashes, explosions, float text)
  for (const fx of state.effects) {
    const t = fx.life / fx.maxLife;
    ctx.save();
    if (fx.kind === 'marker_move') {
      ctx.strokeStyle = `rgba(74, 222, 128, ${t})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 6 + (1 - t) * 18, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'marker_attack') {
      ctx.strokeStyle = `rgba(248, 113, 113, ${t})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 8 + (1 - t) * 20, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'slash') {
      ctx.strokeStyle = `rgba(255, 255, 255, ${t})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx.x - 10, fx.y - 10);
      ctx.lineTo(fx.x + 10, fx.y + 10);
      ctx.stroke();
    } else if (fx.kind === 'explosion') {
      const r = (fx.radius || 40) * (1 - t * 0.4);
      ctx.fillStyle = `rgba(251, 146, 60, ${t * 0.45})`;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(254, 240, 138, ${t * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (fx.kind === 'float_text' && fx.text) {
      ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = fx.color || '#FBBF24';
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.fillText(fx.text, fx.x, fx.y - (1 - t) * 26);
    }
    ctx.restore();
  }

  // 8. Placement Blueprint Ghost (for real-time fortress & building placement)
  if (placement) {
    const def = BUILDING_DEFS[placement.type];
    const spanPx = def.size * 2;
    for (const pos of placement.positions) {
      const valid = canPlaceBuildingAt(state, placement.type, pos.x, pos.y);
      ctx.save();
      ctx.fillStyle = valid ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.4)';
      ctx.strokeStyle = valid ? '#4ADE80' : '#F87171';
      ctx.lineWidth = 2;
      ctx.fillRect(pos.x - spanPx / 2, pos.y - spanPx / 2, spanPx, spanPx);
      ctx.strokeRect(pos.x - spanPx / 2, pos.y - spanPx / 2, spanPx, spanPx);
      ctx.restore();
    }
  }

  // 9. Fog of War Overlay
  if (!revealAllFog) {
    const fog = localPlayer === 1 ? state.fogP1 : state.fogP2;
    const minCol = Math.max(0, Math.floor(viewLeft / FOG_CELL));
    const maxCol = Math.min(state.fogCols - 1, Math.ceil(viewRight / FOG_CELL));
    const minRow = Math.max(0, Math.floor(viewTop / FOG_CELL));
    const maxRow = Math.min(state.fogRows - 1, Math.ceil(viewBottom / FOG_CELL));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const v = fog[r * state.fogCols + c];
        if (v === 2) continue;
        ctx.fillStyle = v === 0 ? 'rgba(8, 11, 16, 0.92)' : 'rgba(10, 14, 20, 0.46)';
        ctx.fillRect(c * FOG_CELL, r * FOG_CELL, FOG_CELL + 1, FOG_CELL + 1);
      }
    }
  }

  ctx.restore();

  // 10. Screen-space Selection Marquee Box
  if (selectionBox) {
    const sx = Math.min(selectionBox.startX, selectionBox.endX);
    const sy = Math.min(selectionBox.startY, selectionBox.endY);
    const sw = Math.abs(selectionBox.endX - selectionBox.startX);
    const sh = Math.abs(selectionBox.endY - selectionBox.startY);
    if (sw > 4 || sh > 4) {
      ctx.save();
      ctx.fillStyle = 'rgba(52, 211, 153, 0.14)';
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 1.5;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.restore();
    }
  }
}

function drawResourceNode(ctx: CanvasRenderingContext2D, res: ResourceNode): void {
  ctx.save();
  ctx.translate(res.x, res.y);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(3, 6, res.radius * 0.95, res.radius * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  if (res.type === 'wood') {
    // Trunk
    ctx.fillStyle = '#5C3D2E';
    ctx.fillRect(-4, -2, 8, 12);
    // Layered pine/oak canopy
    ctx.fillStyle = res.variant === 0 ? '#166534' : res.variant === 1 ? '#15803D' : '#14532D';
    ctx.beginPath();
    ctx.arc(0, -8, res.radius * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22C55E';
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(-4, -12, res.radius * 0.48, 0, Math.PI * 2);
    ctx.fill();
  } else if (res.type === 'gold') {
    ctx.fillStyle = '#92400E';
    ctx.beginPath();
    ctx.moveTo(-res.radius, 8);
    ctx.lineTo(-res.radius * 0.6, -res.radius * 0.7);
    ctx.lineTo(res.radius * 0.4, -res.radius * 0.85);
    ctx.lineTo(res.radius, 6);
    ctx.closePath();
    ctx.fill();
    // Gold veins
    ctx.fillStyle = '#FBBF24';
    ctx.beginPath();
    ctx.arc(-5, -3, 6, 0, Math.PI * 2);
    ctx.arc(6, -1, 5, 0, Math.PI * 2);
    ctx.arc(1, -9, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (res.type === 'stone') {
    ctx.fillStyle = '#64748B';
    ctx.beginPath();
    ctx.moveTo(-res.radius, 9);
    ctx.lineTo(-res.radius * 0.7, -res.radius * 0.6);
    ctx.lineTo(2, -res.radius * 0.9);
    ctx.lineTo(res.radius, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#CBD5E1';
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.lineTo(0, -11);
    ctx.lineTo(9, 1);
    ctx.closePath();
    ctx.fill();
  } else {
    // Berry bush (food)
    ctx.fillStyle = '#15803D';
    ctx.beginPath();
    ctx.arc(0, 0, res.radius * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F43F5E';
    const berries = [
      [-6, -4],
      [5, -6],
      [-2, 4],
      [7, 3],
      [-8, 3],
    ];
    for (const [bx, by] of berries) {
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  b: Building,
  selected: boolean,
  wallSet: Set<string>,
  localPlayer: PlayerId
): void {
  const def = BUILDING_DEFS[b.type];
  const faction = FACTIONS[state.players[b.owner].faction];
  const teamColor = b.owner === 1 ? '#2563EB' : '#DC2626';
  const s = def.size;

  ctx.save();
  ctx.translate(b.x, b.y);

  if (selected) {
    ctx.strokeStyle = b.owner === localPlayer ? '#4ADE80' : '#F87171';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-s - 4, -s - 4, (s + 4) * 2, (s + 4) * 2);
  }

  // Alpha if under construction
  if (!b.built) {
    ctx.globalAlpha = 0.48 + b.buildProgress * 0.45;
  }

  // Drop shadow
  if (b.type !== 'farm') {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(-s + 5, -s + 7, s * 2, s * 2);
  }

  if (b.type === 'wall') {
    const gx = Math.round(b.x / GRID_SIZE);
    const gy = Math.round(b.y / GRID_SIZE);
    const hasL = wallSet.has(`${b.owner}_${gx - 1}_${gy}`);
    const hasR = wallSet.has(`${b.owner}_${gx + 1}_${gy}`);
    const hasU = wallSet.has(`${b.owner}_${gx}_${gy - 1}`);
    const hasD = wallSet.has(`${b.owner}_${gx}_${gy + 1}`);

    ctx.fillStyle = b.hitFlash > 0 ? '#FCA5A5' : '#64748B';
    ctx.fillRect(-14, -14, 28, 28);
    if (hasL) ctx.fillRect(-24, -11, 12, 22);
    if (hasR) ctx.fillRect(12, -11, 12, 22);
    if (hasU) ctx.fillRect(-11, -24, 22, 12);
    if (hasD) ctx.fillRect(-11, 12, 22, 12);

    // Battlement merlons
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(-12, -12, 7, 7);
    ctx.fillRect(5, -12, 7, 7);
    ctx.fillRect(-12, 5, 7, 7);
    ctx.fillRect(5, 5, 7, 7);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(-14, -14, 28, 28);
  } else if (b.type === 'gate') {
    ctx.fillStyle = '#475569';
    ctx.fillRect(-22, -18, 44, 36);
    ctx.fillStyle = b.gateLocked ? '#7F1D1D' : '#92400E';
    ctx.fillRect(-12, -14, 24, 28);
    // Gate bars
    ctx.strokeStyle = b.gateLocked ? '#FCA5A5' : '#FDE68A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -14);
    ctx.lineTo(-6, 14);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, 14);
    ctx.moveTo(6, -14);
    ctx.lineTo(6, 14);
    ctx.stroke();
    // Gate towers on sides
    ctx.fillStyle = teamColor;
    ctx.fillRect(-22, -20, 9, 9);
    ctx.fillRect(13, -20, 9, 9);
  } else if (b.type === 'tower') {
    ctx.fillStyle = b.hitFlash > 0 ? '#FCA5A5' : '#64748B';
    ctx.fillRect(-22, -22, 44, 44);
    ctx.fillStyle = '#475569';
    ctx.fillRect(-16, -16, 32, 32);
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.moveTo(-19, -16);
    ctx.lineTo(0, -32);
    ctx.lineTo(19, -16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2;
    ctx.strokeRect(-22, -22, 44, 44);
  } else if (b.type === 'farm') {
    ctx.fillStyle = '#713F12';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.fillStyle = '#CA8A04';
    for (let fy = -s + 8; fy < s - 6; fy += 12) {
      ctx.fillRect(-s + 6, fy, s * 2 - 12, 6);
    }
    ctx.strokeStyle = '#A16207';
    ctx.lineWidth = 2;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
  } else if (b.type === 'town_center' || b.type === 'castle') {
    // Grand stone foundation
    ctx.fillStyle = b.hitFlash > 0 ? '#FCA5A5' : b.type === 'castle' ? '#475569' : '#78716C';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    // Corner bastions
    const corner = 18;
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(-s, -s, corner, corner);
    ctx.fillRect(s - corner, -s, corner, corner);
    ctx.fillRect(-s, s - corner, corner, corner);
    ctx.fillRect(s - corner, s - corner, corner, corner);
    // Inner keep roof
    ctx.fillStyle = teamColor;
    ctx.fillRect(-s * 0.58, -s * 0.58, s * 1.16, s * 1.16);
    // Gold trim
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-s * 0.58, -s * 0.58, s * 1.16, s * 1.16);
    // Banner flag
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(-2, -s * 0.85, 4, 28);
    ctx.fillStyle = faction.color;
    ctx.beginPath();
    ctx.moveTo(2, -s * 0.85);
    ctx.lineTo(22, -s * 0.78);
    ctx.lineTo(2, -s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
  } else {
    // Standard buildings: house, barracks, archery, stable, blacksmith, siege_workshop
    ctx.fillStyle = b.hitFlash > 0 ? '#FCA5A5' : '#9A7B56';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    // Roof color
    ctx.fillStyle =
      b.type === 'house'
        ? '#B45309'
        : b.type === 'blacksmith'
        ? '#334155'
        : b.type === 'siege_workshop'
        ? '#57534E'
        : teamColor;
    ctx.fillRect(-s + 6, -s + 6, s * 2 - 12, s * 1.1);
    ctx.strokeStyle = '#292524';
    ctx.lineWidth = 2;
    ctx.strokeRect(-s, -s, s * 2, s * 2);

    // Subtle building emblem letter/shape
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    const tag =
      b.type === 'barracks'
        ? 'BARAK'
        : b.type === 'archery'
        ? 'PANAH'
        : b.type === 'stable'
        ? 'KUDA'
        : b.type === 'blacksmith'
        ? 'TEMPA'
        : b.type === 'siege_workshop'
        ? 'KEPUNG'
        : '';
    if (tag) ctx.fillText(tag, 0, s - 8);
  }

  // Construction scaffolding overlay
  if (!b.built) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.setLineDash([]);
  }

  // Health / Construction bar (only when damaged, constructing, or selected)
  ctx.globalAlpha = 1;
  if (!b.built || b.hp < b.maxHp || selected) {
    const bw = Math.max(32, s * 1.5);
    const ratio = Math.max(0, Math.min(1, b.hp / b.maxHp));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(-bw / 2, -s - 12, bw, 5);
    ctx.fillStyle = !b.built ? '#FBBF24' : ratio > 0.5 ? '#22C55E' : ratio > 0.25 ? '#F59E0B' : '#EF4444';
    ctx.fillRect(-bw / 2 + 1, -s - 11, (bw - 2) * ratio, 3);
  }

  ctx.restore();
}

function drawUnit(ctx: CanvasRenderingContext2D, state: GameState, u: Unit, selected: boolean): void {
  const faction = state.players[u.owner].faction;
  const def = getUnitDisplayDef(u.type, faction);
  const teamColor = u.owner === 1 ? '#3B82F6' : '#EF4444';
  const bob = u.state !== 'idle' ? Math.sin(u.animPhase) * 1.8 : 0;

  ctx.save();
  ctx.translate(u.x, u.y);

  // Selection ring
  if (selected) {
    ctx.strokeStyle = '#4ADE80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 4, def.radius + 5, def.radius * 0.72 + 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 6, def.radius * 0.85, def.radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  if (u.type === 'ram') {
    // Battering ram chassis
    ctx.rotate(u.facing);
    ctx.fillStyle = u.hitFlash > 0 ? '#FCA5A5' : '#78350F';
    ctx.fillRect(-16, -10, 32, 20);
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(10, -5, 11, 10); // Iron ram head
    ctx.fillStyle = teamColor;
    ctx.fillRect(-8, -8, 12, 16);
    ctx.strokeStyle = '#1C1917';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-16, -10, 32, 20);
  } else if (u.type === 'catapult') {
    ctx.rotate(u.facing);
    ctx.fillStyle = u.hitFlash > 0 ? '#FCA5A5' : '#92400E';
    ctx.fillRect(-15, -11, 30, 22);
    ctx.fillStyle = '#57534E';
    ctx.fillRect(-12, -13, 6, 26);
    ctx.fillStyle = teamColor;
    ctx.fillRect(-4, -5, 16, 10);
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(-6, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (u.type === 'cavalry' || (u.type === 'unique' && faction === 'byzantium')) {
    // Horse + Rider
    ctx.fillStyle = u.hitFlash > 0 ? '#FCA5A5' : '#78350F';
    ctx.beginPath();
    ctx.ellipse(0, 1 + bob * 0.6, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rider tunic
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(0, -6 + bob, 7, 0, Math.PI * 2);
    ctx.fill();
    // Helmet
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(0, -11 + bob, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Humanoid units
    ctx.fillStyle = u.hitFlash > 0 ? '#FCA5A5' : teamColor;
    ctx.beginPath();
    ctx.arc(0, -1 + bob, def.radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head
    ctx.fillStyle = u.type === 'villager' ? '#FDE68A' : u.type === 'unique' ? '#FBBF24' : '#E2E8F0';
    ctx.beginPath();
    ctx.arc(0, -8 + bob, 5, 0, Math.PI * 2);
    ctx.fill();

    // Weapon / tool indicator
    const wx = Math.cos(u.facing) * 11;
    const wy = Math.sin(u.facing) * 11;
    if (u.type === 'archer' || (u.type === 'unique' && faction === 'ottoman')) {
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx * 0.6, wy * 0.6 - 2 + bob, 6, u.facing - 0.9, u.facing + 0.9);
      ctx.stroke();
    } else if (u.type === 'spearman') {
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -2 + bob);
      ctx.lineTo(wx * 1.5, wy * 1.5 - 2 + bob);
      ctx.stroke();
    } else if (u.type === 'militia' || u.type === 'unique') {
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, -2 + bob);
      ctx.lineTo(wx * 1.2, wy * 1.2 - 4 + bob);
      ctx.stroke();
    } else if (u.type === 'villager' && u.carryAmount > 0) {
      // Carry resource sack indicator
      ctx.fillStyle =
        u.carryType === 'gold'
          ? '#FBBF24'
          : u.carryType === 'wood'
          ? '#22C55E'
          : u.carryType === 'stone'
          ? '#CBD5E1'
          : '#FB7185';
      ctx.beginPath();
      ctx.arc(-5, -2 + bob, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Health bar when hurt or selected
  if (u.hp < u.maxHp || selected) {
    const bw = 24;
    const ratio = Math.max(0, Math.min(1, u.hp / u.maxHp));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(-bw / 2, -def.radius - 13, bw, 4);
    ctx.fillStyle = ratio > 0.5 ? '#22C55E' : ratio > 0.25 ? '#F59E0B' : '#EF4444';
    ctx.fillRect(-bw / 2 + 0.5, -def.radius - 12.5, (bw - 1) * ratio, 3);
  }

  ctx.restore();
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: GameState,
  localPlayer: PlayerId,
  cam: CameraState,
  viewportW: number,
  viewportH: number,
  revealAllFog: boolean
): void {
  const sx = w / state.mapWidth;
  const sy = h / state.mapHeight;

  ctx.fillStyle = '#1D331B';
  ctx.fillRect(0, 0, w, h);

  // Terrain
  for (const t of state.terrain) {
    ctx.fillStyle =
      t.kind === 'water'
        ? '#1E5270'
        : t.kind === 'bridge'
        ? '#78716C'
        : t.kind === 'highland'
        ? '#3A4B2A'
        : '#5F4C31';
    ctx.fillRect(t.x * sx, t.y * sy, t.w * sx, t.h * sy);
  }

  // Resource dots
  for (const r of state.resources) {
    if (!revealAllFog && !isPointExploredByPlayer(state, localPlayer, r.x, r.y)) continue;
    ctx.fillStyle =
      r.type === 'wood'
        ? '#166534'
        : r.type === 'gold'
        ? '#FBBF24'
        : r.type === 'stone'
        ? '#94A3B8'
        : '#F43F5E';
    ctx.fillRect(r.x * sx - 1, r.y * sy - 1, 2.5, 2.5);
  }

  // Buildings
  for (const b of state.buildings) {
    if (b.owner !== localPlayer && !revealAllFog && !isPointExploredByPlayer(state, localPlayer, b.x, b.y)) continue;
    ctx.fillStyle = b.owner === 1 ? '#3B82F6' : '#EF4444';
    const bs = Math.max(3, BUILDING_DEFS[b.type].gridSpan * 2.2);
    ctx.fillRect(b.x * sx - bs / 2, b.y * sy - bs / 2, bs, bs);
  }

  // Units
  for (const u of state.units) {
    if (u.owner !== localPlayer && !revealAllFog && !isPointVisibleToPlayer(state, localPlayer, u.x, u.y)) continue;
    ctx.fillStyle = u.owner === 1 ? '#93C5FD' : '#FCA5A5';
    ctx.fillRect(u.x * sx - 1.5, u.y * sy - 1.5, 3, 3);
  }

  // Fog shroud on minimap
  if (!revealAllFog) {
    const fog = localPlayer === 1 ? state.fogP1 : state.fogP2;
    const cw = (FOG_CELL * sx) + 0.5;
    const ch = (FOG_CELL * sy) + 0.5;
    for (let r = 0; r < state.fogRows; r++) {
      for (let c = 0; c < state.fogCols; c++) {
        const v = fog[r * state.fogCols + c];
        if (v === 2) continue;
        ctx.fillStyle = v === 0 ? 'rgba(8, 11, 16, 0.9)' : 'rgba(8, 11, 16, 0.4)';
        ctx.fillRect(c * FOG_CELL * sx, r * FOG_CELL * sy, cw, ch);
      }
    }
  }

  // Camera viewport box
  const vw = (viewportW / cam.zoom) * sx;
  const vh = (viewportH / cam.zoom) * sy;
  const vx = cam.x * sx - vw / 2;
  const vy = cam.y * sy - vh / 2;
  ctx.strokeStyle = '#F8FAFC';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, vw, vh);
}
