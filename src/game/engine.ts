import {
  AGE_ADVANCE_COST,
  AGE_ADVANCE_TIME,
  AGE_NAMES,
  BUILDING_DEFS,
  FOG_CELL,
  GRID_SIZE,
  MAP_HEIGHT,
  MAP_WIDTH,
  UNIT_DEFS,
  canAfford,
  getBuildingCost,
  getUnitDisplayDef,
  refundResources,
  spendResources,
} from './constants';
import {
  AIDifficulty,
  AgeLevel,
  Building,
  BuildingType,
  FactionId,
  GameCommand,
  GameState,
  MapStyle,
  PlayerId,
  ResourceNode,
  ResourceType,
  TerrainTile,
  Unit,
  UnitType,
} from './types';

let idSeq = 1;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

export function snapToGrid(v: number, span = 1): number {
  if (span % 2 === 1) {
    return Math.floor(v / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2;
  }
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export function getPlayerPopStats(state: GameState, playerId: PlayerId): { used: number; cap: number } {
  const used =
    state.units.filter((u) => u.owner === playerId).length +
    state.buildings
      .filter((b) => b.owner === playerId)
      .reduce((acc, b) => acc + b.queue.length, 0);

  const cap = state.buildings
    .filter((b) => b.owner === playerId && b.built)
    .reduce((acc, b) => acc + BUILDING_DEFS[b.type].popBonus, 0);

  return { used, cap: Math.max(5, Math.min(80, cap)) };
}

function createInitialBuilding(
  owner: PlayerId,
  type: BuildingType,
  x: number,
  y: number,
  faction: FactionId,
  built = true
): Building {
  const def = BUILDING_DEFS[type];
  const hpMult = faction === 'majapahit' ? 1.15 : 1;
  const maxHp = Math.round(def.maxHp * hpMult);
  return {
    id: nextId('b'),
    owner,
    type,
    x,
    y,
    hp: built ? maxHp : Math.max(20, Math.round(maxHp * 0.15)),
    maxHp,
    built,
    buildProgress: built ? 1 : 0.1,
    attackTimer: 0,
    queue: [],
    rallyX: owner === 1 ? x + 115 : x - 115,
    rallyY: owner === 1 ? y + 70 : y - 70,
    gateLocked: false,
    hitFlash: 0,
  };
}

function createUnit(owner: PlayerId, type: UnitType, x: number, y: number, faction: FactionId): Unit {
  const def = getUnitDisplayDef(type, faction);
  return {
    id: nextId('u'),
    owner,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: def.maxHp,
    maxHp: def.maxHp,
    state: 'idle',
    targetX: x,
    targetY: y,
    targetUnitId: null,
    targetBuildingId: null,
    targetResourceId: null,
    carryType: null,
    carryAmount: 0,
    attackTimer: 0,
    gatherTimer: 0,
    facing: owner === 1 ? 0 : Math.PI,
    animPhase: Math.random() * Math.PI * 2,
    hitFlash: 0,
    stance: 'aggressive',
  };
}

export function createInitialGameState(options: {
  p1Name: string;
  p2Name: string;
  p1Faction: FactionId;
  p2Faction: FactionId;
  mapStyle: MapStyle;
  difficulty: AIDifficulty;
}): GameState {
  idSeq = 100;
  const fogCols = Math.ceil(MAP_WIDTH / FOG_CELL);
  const fogRows = Math.ceil(MAP_HEIGHT / FOG_CELL);

  const terrain: TerrainTile[] = [];
  if (options.mapStyle === 'river') {
    // Diagonal/vertical river down center with 2 stone bridges
    terrain.push({ x: MAP_WIDTH / 2 - 64, y: 0, w: 128, h: MAP_HEIGHT, kind: 'water' });
    terrain.push({ x: MAP_WIDTH / 2 - 72, y: 420, w: 144, h: 168, kind: 'bridge' });
    terrain.push({ x: MAP_WIDTH / 2 - 72, y: MAP_HEIGHT - 588, w: 144, h: 168, kind: 'bridge' });
  } else if (options.mapStyle === 'highland') {
    terrain.push({ x: MAP_WIDTH / 2 - 360, y: MAP_HEIGHT / 2 - 260, w: 720, h: 520, kind: 'highland' });
  } else {
    // Valley road connecting both kingdoms
    terrain.push({ x: 380, y: MAP_HEIGHT - 440, w: 220, h: 90, kind: 'road' });
    terrain.push({ x: MAP_WIDTH - 600, y: 350, w: 220, h: 90, kind: 'road' });
  }

  const p1TCX = snapToGrid(360, 3);
  const p1TCY = snapToGrid(MAP_HEIGHT - 360, 3);
  const p2TCX = snapToGrid(MAP_WIDTH - 360, 3);
  const p2TCY = snapToGrid(360, 3);

  const buildings: Building[] = [
    createInitialBuilding(1, 'town_center', p1TCX, p1TCY, options.p1Faction, true),
    createInitialBuilding(1, 'house', snapToGrid(p1TCX - 168, 2), snapToGrid(p1TCY + 96, 2), options.p1Faction, true),
    createInitialBuilding(2, 'town_center', p2TCX, p2TCY, options.p2Faction, true),
    createInitialBuilding(2, 'house', snapToGrid(p2TCX + 168, 2), snapToGrid(p2TCY - 96, 2), options.p2Faction, true),
  ];

  const units: Unit[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 1.4 - 0.5;
    units.push(
      createUnit(1, 'villager', p1TCX + Math.cos(angle) * 105, p1TCY + Math.sin(angle) * 105, options.p1Faction)
    );
    units.push(
      createUnit(2, 'villager', p2TCX - Math.cos(angle) * 105, p2TCY - Math.sin(angle) * 105, options.p2Faction)
    );
  }
  // Starting scouts / guards
  units.push(createUnit(1, 'militia', p1TCX + 125, p1TCY - 70, options.p1Faction));
  units.push(createUnit(2, 'militia', p2TCX - 125, p2TCY + 70, options.p2Faction));

  // Generate balanced symmetric resource clusters
  const resources: ResourceNode[] = [];
  const addSymmetricCluster = (
    type: ResourceType,
    offsetX: number,
    offsetY: number,
    count: number,
    amount: number,
    radius: number,
    spread: number
  ) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.3;
      const r = count === 1 ? 0 : spread * (0.6 + (i % 2) * 0.45);
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      resources.push({
        id: nextId('res'),
        type,
        x: Math.max(60, Math.min(MAP_WIDTH - 60, offsetX + dx)),
        y: Math.max(60, Math.min(MAP_HEIGHT - 60, offsetY + dy)),
        amount,
        maxAmount: amount,
        radius,
        variant: i % 3,
      });
      resources.push({
        id: nextId('res'),
        type,
        x: Math.max(60, Math.min(MAP_WIDTH - 60, MAP_WIDTH - offsetX - dx)),
        y: Math.max(60, Math.min(MAP_HEIGHT - 60, MAP_HEIGHT - offsetY - dy)),
        amount,
        maxAmount: amount,
        radius,
        variant: i % 3,
      });
    }
  };

  // Starting berries near each TC
  addSymmetricCluster('food', p1TCX - 190, p1TCY - 120, 4, 220, 17, 36);
  // Starting forests near each base
  addSymmetricCluster('wood', p1TCX + 40, p1TCY - 250, 7, 250, 19, 64);
  addSymmetricCluster('wood', p1TCX - 240, p1TCY + 180, 6, 250, 19, 58);
  // Starting Gold & Stone near base
  addSymmetricCluster('gold', p1TCX + 260, p1TCY + 60, 4, 480, 21, 44);
  addSymmetricCluster('stone', p1TCX - 200, p1TCY - 290, 4, 460, 21, 44);

  // Mid-map expansion resources (contested strategic zones!)
  addSymmetricCluster('gold', MAP_WIDTH * 0.36, MAP_HEIGHT * 0.34, 4, 650, 22, 48);
  addSymmetricCluster('stone', MAP_WIDTH * 0.38, MAP_HEIGHT * 0.72, 4, 620, 22, 46);
  addSymmetricCluster('wood', MAP_WIDTH * 0.25, MAP_HEIGHT * 0.5, 6, 280, 20, 66);
  addSymmetricCluster('food', MAP_WIDTH * 0.44, MAP_HEIGHT * 0.52, 3, 260, 18, 34);

  // Center crown gold deposit (only if not river center water)
  if (options.mapStyle !== 'river') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      resources.push({
        id: nextId('res'),
        type: 'gold',
        x: MAP_WIDTH / 2 + Math.cos(a) * 58,
        y: MAP_HEIGHT / 2 + Math.sin(a) * 58,
        amount: 800,
        maxAmount: 800,
        radius: 23,
        variant: i % 3,
      });
    }
  } else {
    // Near bridges
    addSymmetricCluster('gold', MAP_WIDTH / 2 - 220, 490, 3, 600, 21, 38);
    addSymmetricCluster('stone', MAP_WIDTH / 2 - 220, MAP_HEIGHT - 510, 3, 580, 21, 38);
  }

  const state: GameState = {
    tick: 0,
    elapsed: 0,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    mapStyle: options.mapStyle,
    paused: false,
    speed: 1,
    winner: null,
    winReason: null,
    players: {
      1: {
        id: 1,
        name: options.p1Name || 'Kerajaan Anda',
        faction: options.p1Faction,
        age: 1,
        ageAdvancing: null,
        resources: { wood: 260, food: 260, gold: 140, stone: 180 },
        attackUpgrade: 0,
        armorUpgrade: 0,
        score: 0,
        unitsKilled: 0,
        buildingsDestroyed: 0,
        resourcesGathered: 0,
      },
      2: {
        id: 2,
        name: options.p2Name || 'Kerajaan Lawan',
        faction: options.p2Faction,
        age: 1,
        ageAdvancing: null,
        resources: { wood: 260, food: 260, gold: 140, stone: 180 },
        attackUpgrade: 0,
        armorUpgrade: 0,
        score: 0,
        unitsKilled: 0,
        buildingsDestroyed: 0,
        resourcesGathered: 0,
      },
    },
    buildings,
    units,
    resources,
    projectiles: [],
    effects: [],
    terrain,
    fogCols,
    fogRows,
    fogP1: new Array(fogCols * fogRows).fill(0),
    fogP2: new Array(fogCols * fogRows).fill(0),
    aiState: {
      difficulty: options.difficulty,
      decisionTimer: 1.5,
      waveCount: 0,
      wallBuilt: false,
    },
    lastAlertP1: null,
    lastAlertP2: null,
  };

  updateFogOfWar(state);
  return state;
}

export function isWaterBlocked(state: GameState, x: number, y: number): boolean {
  let inWater = false;
  for (const t of state.terrain) {
    if (t.kind === 'bridge') {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        return false; // Bridges override water
      }
    } else if (t.kind === 'water') {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        inWater = true;
      }
    }
  }
  return inWater;
}

export function canPlaceBuildingAt(
  state: GameState,
  type: BuildingType,
  x: number,
  y: number
): boolean {
  const def = BUILDING_DEFS[type];
  const r = def.size;
  if (x - r < 24 || x + r > state.mapWidth - 24 || y - r < 24 || y + r > state.mapHeight - 24) {
    return false;
  }
  if (isWaterBlocked(state, x, y) || isWaterBlocked(state, x - r * 0.7, y) || isWaterBlocked(state, x + r * 0.7, y)) {
    return false;
  }

  for (const b of state.buildings) {
    const minD = r + BUILDING_DEFS[b.type].size - 4;
    if (Math.abs(b.x - x) < minD && Math.abs(b.y - y) < minD) {
      return false;
    }
  }

  // Farms can overlap units slightly, others check resources
  for (const res of state.resources) {
    const d = Math.hypot(res.x - x, res.y - y);
    if (d < r + res.radius - 4) {
      return false;
    }
  }

  return true;
}

export function applyGameCommand(state: GameState, cmd: GameCommand): void {
  if (state.winner && cmd.type !== 'toggle_pause') return;
  const player = state.players[cmd.playerId];
  if (!player) return;

  switch (cmd.type) {
    case 'toggle_pause': {
      state.paused = !state.paused;
      break;
    }
    case 'set_speed': {
      state.speed = cmd.speed;
      break;
    }
    case 'move': {
      const units = state.units.filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id));
      const count = units.length;
      const cols = Math.ceil(Math.sqrt(count));
      units.forEach((u, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const offsetX = (col - (cols - 1) / 2) * 32;
        const offsetY = (row - (Math.ceil(count / cols) - 1) / 2) * 32;
        u.state = 'moving';
        u.targetX = Math.max(30, Math.min(state.mapWidth - 30, cmd.x + offsetX));
        u.targetY = Math.max(30, Math.min(state.mapHeight - 30, cmd.y + offsetY));
        u.targetUnitId = null;
        u.targetBuildingId = null;
        u.targetResourceId = null;
      });
      if (units.length > 0) {
        state.effects.push({
          id: nextId('fx'),
          kind: 'marker_move',
          x: cmd.x,
          y: cmd.y,
          life: 0.45,
          maxLife: 0.45,
        });
      }
      break;
    }
    case 'attack_unit': {
      const target = state.units.find((u) => u.id === cmd.targetUnitId);
      if (!target) break;
      state.units
        .filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id))
        .forEach((u) => {
          u.state = 'attacking';
          u.targetUnitId = target.id;
          u.targetBuildingId = null;
          u.targetResourceId = null;
        });
      state.effects.push({
        id: nextId('fx'),
        kind: 'marker_attack',
        x: target.x,
        y: target.y,
        life: 0.5,
        maxLife: 0.5,
      });
      break;
    }
    case 'attack_building': {
      const target = state.buildings.find((b) => b.id === cmd.targetBuildingId);
      if (!target) break;
      state.units
        .filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id))
        .forEach((u) => {
          u.state = 'attacking';
          u.targetBuildingId = target.id;
          u.targetUnitId = null;
          u.targetResourceId = null;
        });
      state.effects.push({
        id: nextId('fx'),
        kind: 'marker_attack',
        x: target.x,
        y: target.y,
        life: 0.5,
        maxLife: 0.5,
      });
      break;
    }
    case 'gather': {
      const res = state.resources.find((r) => r.id === cmd.resourceId);
      if (!res) break;
      state.units
        .filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id) && u.type === 'villager')
        .forEach((u) => {
          u.state = 'gathering';
          u.targetResourceId = res.id;
          u.targetBuildingId = null;
          u.targetUnitId = null;
        });
      break;
    }
    case 'repair_or_build': {
      const b = state.buildings.find((bld) => bld.id === cmd.buildingId && bld.owner === cmd.playerId);
      if (!b) break;
      state.units
        .filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id) && u.type === 'villager')
        .forEach((u) => {
          u.state = 'building';
          u.targetBuildingId = b.id;
          u.targetResourceId = null;
          u.targetUnitId = null;
        });
      break;
    }
    case 'place_buildings': {
      const def = BUILDING_DEFS[cmd.buildingType];
      if (player.age < def.minAge) break;
      const cost = getBuildingCost(cmd.buildingType, player.faction);
      const created: Building[] = [];
      for (const pos of cmd.positions) {
        if (!canAfford(player.resources, cost)) break;
        if (!canPlaceBuildingAt(state, cmd.buildingType, pos.x, pos.y)) continue;
        spendResources(player.resources, cost);
        const nb = createInitialBuilding(cmd.playerId, cmd.buildingType, pos.x, pos.y, player.faction, false);
        state.buildings.push(nb);
        created.push(nb);
      }
      if (created.length > 0) {
        const builders = state.units.filter(
          (u) => u.owner === cmd.playerId && u.type === 'villager' && cmd.builderUnitIds.includes(u.id)
        );
        // If no builders specified, auto-pick nearest idle villager
        if (builders.length === 0) {
          const fallback = state.units
            .filter((u) => u.owner === cmd.playerId && u.type === 'villager' && u.state === 'idle')
            .sort(
              (a, b) =>
                Math.hypot(a.x - created[0].x, a.y - created[0].y) -
                Math.hypot(b.x - created[0].x, b.y - created[0].y)
            )[0];
          if (fallback) builders.push(fallback);
        }
        builders.forEach((u, idx) => {
          const targetB = created[idx % created.length];
          u.state = 'building';
          u.targetBuildingId = targetB.id;
          u.targetResourceId = null;
          u.targetUnitId = null;
        });
      }
      break;
    }
    case 'train_unit': {
      const b = state.buildings.find((bld) => bld.id === cmd.buildingId && bld.owner === cmd.playerId && bld.built);
      if (!b) break;
      const bDef = BUILDING_DEFS[b.type];
      if (!bDef.trains?.includes(cmd.unitType)) break;
      if (b.queue.length >= 6) break;
      const uDef = UNIT_DEFS[cmd.unitType];
      if (player.age < uDef.minAge) break;
      const pop = getPlayerPopStats(state, cmd.playerId);
      if (pop.used >= pop.cap) break;
      if (!canAfford(player.resources, uDef.cost)) break;
      spendResources(player.resources, uDef.cost);
      b.queue.push({
        unitType: cmd.unitType,
        remaining: uDef.trainTime,
        total: uDef.trainTime,
      });
      break;
    }
    case 'cancel_train': {
      const b = state.buildings.find((bld) => bld.id === cmd.buildingId && bld.owner === cmd.playerId);
      if (!b || cmd.index < 0 || cmd.index >= b.queue.length) break;
      const [removed] = b.queue.splice(cmd.index, 1);
      refundResources(player.resources, UNIT_DEFS[removed.unitType].cost, 1);
      break;
    }
    case 'advance_age': {
      if (player.age >= 3 || player.ageAdvancing) break;
      const nextAge = (player.age + 1) as 2 | 3;
      const cost = AGE_ADVANCE_COST[nextAge];
      if (!canAfford(player.resources, cost)) break;
      spendResources(player.resources, cost);
      const t = AGE_ADVANCE_TIME[nextAge];
      player.ageAdvancing = { targetAge: nextAge, remaining: t, total: t };
      break;
    }
    case 'upgrade_tech': {
      const hasBlacksmith = state.buildings.some(
        (b) => b.owner === cmd.playerId && b.type === 'blacksmith' && b.built
      );
      if (!hasBlacksmith) break;
      const level = cmd.tech === 'attack' ? player.attackUpgrade : player.armorUpgrade;
      if (level >= 2) break;
      const cost = { food: 120 + level * 90, gold: 80 + level * 80 };
      if (!canAfford(player.resources, cost)) break;
      spendResources(player.resources, cost);
      if (cmd.tech === 'attack') player.attackUpgrade += 1;
      else player.armorUpgrade += 1;
      break;
    }
    case 'toggle_gate': {
      const b = state.buildings.find(
        (bld) => bld.id === cmd.buildingId && bld.owner === cmd.playerId && bld.type === 'gate'
      );
      if (b) b.gateLocked = !b.gateLocked;
      break;
    }
    case 'demolish_building': {
      const idx = state.buildings.findIndex((b) => b.id === cmd.buildingId && b.owner === cmd.playerId);
      if (idx === -1) break;
      const b = state.buildings[idx];
      // Prevent deleting last town center manually
      const tcs = state.buildings.filter((x) => x.owner === cmd.playerId && x.type === 'town_center');
      if (b.type === 'town_center' && tcs.length <= 1) break;
      refundResources(player.resources, getBuildingCost(b.type, player.faction), 0.4);
      state.buildings.splice(idx, 1);
      break;
    }
    case 'set_rally': {
      const b = state.buildings.find((bld) => bld.id === cmd.buildingId && bld.owner === cmd.playerId);
      if (b) {
        b.rallyX = Math.max(30, Math.min(state.mapWidth - 30, cmd.x));
        b.rallyY = Math.max(30, Math.min(state.mapHeight - 30, cmd.y));
      }
      break;
    }
    case 'set_stance': {
      state.units
        .filter((u) => u.owner === cmd.playerId && cmd.unitIds.includes(u.id))
        .forEach((u) => {
          u.stance = cmd.stance;
        });
      break;
    }
  }
}

export function stepGameSimulation(
  state: GameState,
  dt: number,
  enableAI: boolean,
  onSound?: (kind: 'build' | 'arrow' | 'sword' | 'siege' | 'victory' | 'defeat') => void
): void {
  if (state.paused || state.winner) return;

  const simDt = Math.min(0.05, dt) * state.speed;
  state.tick += 1;
  state.elapsed += simDt;

  // 1. Age Advancing
  ([1, 2] as PlayerId[]).forEach((pid) => {
    const p = state.players[pid];
    if (p.ageAdvancing) {
      p.ageAdvancing.remaining -= simDt;
      if (p.ageAdvancing.remaining <= 0) {
        p.age = p.ageAdvancing.targetAge;
        p.ageAdvancing = null;
        p.score += 350;
        const msg = `${p.name} mencapai ${AGE_NAMES[p.age]}!`;
        if (pid === 1) state.lastAlertP1 = { text: msg, time: state.elapsed };
        else state.lastAlertP2 = { text: msg, time: state.elapsed };
      }
    }
  });

  // 2. Buildings: training queues & defensive tower/castle/TC fire
  for (const b of state.buildings) {
    if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - simDt);
    if (!b.built) continue;

    // Training queue
    if (b.queue.length > 0) {
      const current = b.queue[0];
      current.remaining -= simDt;
      if (current.remaining <= 0) {
        const pop = getPlayerPopStats(state, b.owner);
        // pop already includes queue length, so spawning 1 unit replaces 1 queue slot
        if (pop.used <= pop.cap + 1) {
          b.queue.shift();
          const def = BUILDING_DEFS[b.type];
          const angle = Math.atan2(b.rallyY - b.y, b.rallyX - b.x);
          const spawnX = b.x + Math.cos(angle) * (def.size + 22);
          const spawnY = b.y + Math.sin(angle) * (def.size + 22);
          const unit = createUnit(b.owner, current.unitType, spawnX, spawnY, state.players[b.owner].faction);
          unit.state = 'moving';
          unit.targetX = b.rallyX + (Math.random() - 0.5) * 30;
          unit.targetY = b.rallyY + (Math.random() - 0.5) * 30;
          state.units.push(unit);
        }
      }
    }

    // Defensive firing (Town Center, Tower, Castle)
    const bDef = BUILDING_DEFS[b.type];
    if (bDef.attackDamage && bDef.attackRange && bDef.attackCooldown) {
      b.attackTimer -= simDt;
      if (b.attackTimer <= 0) {
        const rangeBonus =
          state.players[b.owner].faction === 'byzantium' && b.type === 'tower' ? 1.2 : 1;
        const maxRange = bDef.attackRange * rangeBonus;
        let nearestEnemy: Unit | null = null;
        let bestDist = maxRange;
        for (const u of state.units) {
          if (u.owner === b.owner || u.hp <= 0) continue;
          const d = Math.hypot(u.x - b.x, u.y - b.y);
          if (d <= bestDist) {
            bestDist = d;
            nearestEnemy = u;
          }
        }
        if (nearestEnemy) {
          b.attackTimer = bDef.attackCooldown;
          state.projectiles.push({
            id: nextId('p'),
            owner: b.owner,
            x: b.x,
            y: b.y - 24,
            startX: b.x,
            startY: b.y - 24,
            targetX: nearestEnemy.x,
            targetY: nearestEnemy.y,
            targetUnitId: nearestEnemy.id,
            targetBuildingId: null,
            progress: 0,
            speed: 520,
            damage: bDef.attackDamage,
            siegeBonus: 1,
            splashRadius: 0,
            kind: 'arrow',
          });
          onSound?.('arrow');
        }
      }
    }
  }

  // 3. Units AI & Movement
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - simDt);
    if (u.attackTimer > 0) u.attackTimer = Math.max(0, u.attackTimer - simDt);

    const pState = state.players[u.owner];
    const uDef = getUnitDisplayDef(u.type, pState.faction);

    // Villager Farm auto-gathering or resource gathering
    if (u.type === 'villager') {
      if (u.state === 'building' && u.targetBuildingId) {
        const b = state.buildings.find((bld) => bld.id === u.targetBuildingId);
        if (!b || (b.built && b.hp >= b.maxHp)) {
          u.state = 'idle';
          u.targetBuildingId = null;
        } else {
          const bSize = BUILDING_DEFS[b.type].size;
          const dist = Math.hypot(b.x - u.x, b.y - u.y);
          if (dist > bSize + 24) {
            moveUnitTowards(state, u, b.x, b.y, uDef.speed, simDt, false);
          } else {
            u.facing = Math.atan2(b.y - u.y, b.x - u.x);
            u.animPhase += simDt * 12;
            const buildSpeedMult = pState.faction === 'majapahit' ? 1.15 : 1;
            if (!b.built) {
              const rate = (1 / BUILDING_DEFS[b.type].buildTime) * buildSpeedMult;
              b.buildProgress = Math.min(1, b.buildProgress + rate * simDt);
              b.hp = Math.min(b.maxHp, b.hp + b.maxHp * rate * simDt);
              if (b.buildProgress >= 1) {
                b.built = true;
                b.hp = b.maxHp;
                pState.score += 65;
                onSound?.('build');
                // Look for adjacent unfinished wall/building!
                const nextSite = state.buildings.find(
                  (other) =>
                    other.owner === u.owner &&
                    !other.built &&
                    Math.hypot(other.x - u.x, other.y - u.y) < 160
                );
                if (nextSite) {
                  u.targetBuildingId = nextSite.id;
                } else {
                  u.state = 'idle';
                  u.targetBuildingId = null;
                }
              }
            } else if (b.hp < b.maxHp) {
              b.hp = Math.min(b.maxHp, b.hp + 38 * buildSpeedMult * simDt);
            }
          }
          continue;
        }
      }

      if (u.state === 'gathering') {
        // Check if carrying full
        if (u.carryAmount >= 12) {
          u.state = 'returning';
        } else {
          // Check farm or resource node
          const res = state.resources.find((r) => r.id === u.targetResourceId);
          if (!res || res.amount <= 0) {
            // Find nearest same resource type
            const fallback = state.resources
              .filter((r) => r.amount > 0 && (!u.carryType || r.type === u.carryType))
              .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
            if (fallback && Math.hypot(fallback.x - u.x, fallback.y - u.y) < 340) {
              u.targetResourceId = fallback.id;
            } else if (u.carryAmount > 0) {
              u.state = 'returning';
            } else {
              // Check nearby farm
              const farm = state.buildings.find(
                (b) => b.owner === u.owner && b.type === 'farm' && b.built && Math.hypot(b.x - u.x, b.y - u.y) < 120
              );
              if (farm) {
                u.carryType = 'food';
                u.gatherTimer += simDt;
                if (u.gatherTimer >= 1.1) {
                  u.gatherTimer = 0;
                  u.carryAmount += 3;
                }
              } else {
                u.state = 'idle';
                u.targetResourceId = null;
              }
            }
            continue;
          }

          const dist = Math.hypot(res.x - u.x, res.y - u.y);
          if (dist > res.radius + uDef.radius + 10) {
            moveUnitTowards(state, u, res.x, res.y, uDef.speed, simDt, false);
          } else {
            u.facing = Math.atan2(res.y - u.y, res.x - u.x);
            u.animPhase += simDt * 10;
            u.carryType = res.type;
            const gatherMult = pState.faction === 'ottoman' ? 1.1 : 1;
            u.gatherTimer += simDt * gatherMult;
            if (u.gatherTimer >= 0.75) {
              u.gatherTimer = 0;
              const take = Math.min(3, res.amount, 12 - u.carryAmount);
              res.amount -= take;
              u.carryAmount += take;
              if (res.amount <= 0) {
                state.resources = state.resources.filter((r) => r.id !== res.id);
              }
              if (u.carryAmount >= 12) {
                u.state = 'returning';
              }
            }
          }
          continue;
        }
      }

      if (u.state === 'returning') {
        const dropoff = state.buildings
          .filter((b) => b.owner === u.owner && b.built && (b.type === 'town_center' || b.type === 'castle'))
          .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];

        if (!dropoff) {
          if (u.carryType && u.carryAmount > 0) {
            pState.resources[u.carryType] += u.carryAmount;
            u.carryAmount = 0;
          }
          u.state = 'idle';
          continue;
        }

        const bSize = BUILDING_DEFS[dropoff.type].size;
        const dist = Math.hypot(dropoff.x - u.x, dropoff.y - u.y);
        if (dist > bSize + 24) {
          moveUnitTowards(state, u, dropoff.x, dropoff.y, uDef.speed, simDt, false);
        } else {
          if (u.carryType && u.carryAmount > 0) {
            pState.resources[u.carryType] += u.carryAmount;
            pState.resourcesGathered += u.carryAmount;
            pState.score += u.carryAmount;
            state.effects.push({
              id: nextId('fx'),
              kind: 'float_text',
              x: dropoff.x + (Math.random() - 0.5) * 26,
              y: dropoff.y - 36,
              life: 0.9,
              maxLife: 0.9,
              text: `+${u.carryAmount}`,
              color:
                u.carryType === 'gold'
                  ? '#FBBF24'
                  : u.carryType === 'wood'
                  ? '#4ADE80'
                  : u.carryType === 'stone'
                  ? '#CBD5E1'
                  : '#FB7185',
            });
            u.carryAmount = 0;
          }
          if (u.targetResourceId) {
            u.state = 'gathering';
          } else {
            u.state = 'idle';
          }
        }
        continue;
      }

      // If villager is idle next to an unfinished building, help build!
      if (u.state === 'idle') {
        const nearbyFarm = state.buildings.find(
          (b) => b.owner === u.owner && b.type === 'farm' && b.built && Math.hypot(b.x - u.x, b.y - u.y) < 55
        );
        if (nearbyFarm) {
          u.carryType = 'food';
          u.gatherTimer += simDt;
          u.animPhase += simDt * 8;
          if (u.gatherTimer >= 1.2) {
            u.gatherTimer = 0;
            pState.resources.food += 4;
            pState.resourcesGathered += 4;
          }
          continue;
        }
      }
    }

    // Combat & Auto-acquire for military units
    if (u.state === 'idle' && u.type !== 'villager' && u.stance === 'aggressive') {
      const aggroRange = Math.max(200, uDef.range + 90);
      let nearestEnemyUnit: Unit | null = null;
      let bestDist = aggroRange;
      for (const e of state.units) {
        if (e.owner === u.owner || e.hp <= 0) continue;
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d < bestDist) {
          bestDist = d;
          nearestEnemyUnit = e;
        }
      }
      if (nearestEnemyUnit) {
        u.state = 'attacking';
        u.targetUnitId = nearestEnemyUnit.id;
      } else {
        let nearestEnemyBld: Building | null = null;
        let bestBDist = aggroRange;
        for (const eb of state.buildings) {
          if (eb.owner === u.owner || eb.hp <= 0) continue;
          const d = Math.hypot(eb.x - u.x, eb.y - u.y) - BUILDING_DEFS[eb.type].size;
          if (d < bestBDist) {
            bestBDist = d;
            nearestEnemyBld = eb;
          }
        }
        if (nearestEnemyBld) {
          u.state = 'attacking';
          u.targetBuildingId = nearestEnemyBld.id;
        }
      }
    }

    if (u.state === 'attacking') {
      const targetU = u.targetUnitId ? state.units.find((x) => x.id === u.targetUnitId && x.hp > 0) : null;
      const targetB = u.targetBuildingId ? state.buildings.find((x) => x.id === u.targetBuildingId && x.hp > 0) : null;

      if (targetU) {
        const dist = Math.hypot(targetU.x - u.x, targetU.y - u.y);
        if (dist > uDef.range + getUnitDisplayDef(targetU.type, state.players[targetU.owner].faction).radius) {
          const blockedByWall = moveUnitTowards(state, u, targetU.x, targetU.y, uDef.speed, simDt, true);
          if (blockedByWall) {
            u.targetBuildingId = blockedByWall.id;
            u.targetUnitId = null;
          }
        } else {
          u.facing = Math.atan2(targetU.y - u.y, targetU.x - u.x);
          if (u.attackTimer <= 0) {
            u.attackTimer = uDef.attackCooldown;
            performUnitAttackOnUnit(state, u, targetU, uDef, onSound);
          }
        }
        continue;
      } else if (targetB) {
        const bSize = BUILDING_DEFS[targetB.type].size;
        const dist = Math.hypot(targetB.x - u.x, targetB.y - u.y) - bSize;
        if (dist > uDef.range) {
          const blockedByWall = moveUnitTowards(state, u, targetB.x, targetB.y, uDef.speed, simDt, true);
          if (blockedByWall && blockedByWall.id !== targetB.id) {
            u.targetBuildingId = blockedByWall.id;
          }
        } else {
          u.facing = Math.atan2(targetB.y - u.y, targetB.x - u.x);
          if (u.attackTimer <= 0) {
            u.attackTimer = uDef.attackCooldown;
            performUnitAttackOnBuilding(state, u, targetB, uDef, onSound);
          }
        }
        continue;
      } else {
        u.state = 'idle';
        u.targetUnitId = null;
        u.targetBuildingId = null;
      }
    }

    if (u.state === 'moving') {
      const dist = Math.hypot(u.targetX - u.x, u.targetY - u.y);
      if (dist < 10) {
        u.state = 'idle';
        u.vx = 0;
        u.vy = 0;
      } else {
        const blockedByWall = moveUnitTowards(state, u, u.targetX, u.targetY, uDef.speed, simDt, true);
        if (blockedByWall && u.type !== 'villager') {
          u.state = 'attacking';
          u.targetBuildingId = blockedByWall.id;
        }
      }
    }
  }

  // Soft unit-to-unit separation so armies don't stack into 1 pixel
  for (let i = 0; i < state.units.length; i++) {
    const a = state.units[i];
    if (a.hp <= 0) continue;
    for (let j = i + 1; j < state.units.length; j++) {
      const b = state.units[j];
      if (b.hp <= 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const minD = 22;
      if (d2 > 0.01 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.32;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  // 4. Projectiles
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (p.targetUnitId) {
      const tu = state.units.find((u) => u.id === p.targetUnitId && u.hp > 0);
      if (tu) {
        p.targetX = tu.x;
        p.targetY = tu.y;
      }
    } else if (p.targetBuildingId) {
      const tb = state.buildings.find((b) => b.id === p.targetBuildingId && b.hp > 0);
      if (tb) {
        p.targetX = tb.x;
        p.targetY = tb.y;
      }
    }

    const totalDist = Math.max(10, Math.hypot(p.targetX - p.startX, p.targetY - p.startY));
    p.progress += (p.speed * simDt) / totalDist;
    p.x = p.startX + (p.targetX - p.startX) * Math.min(1, p.progress);
    p.y = p.startY + (p.targetY - p.startY) * Math.min(1, p.progress);

    if (p.progress >= 1) {
      if (p.splashRadius > 0) {
        // Catapult AoE boulder impact
        state.effects.push({
          id: nextId('fx'),
          kind: 'explosion',
          x: p.targetX,
          y: p.targetY,
          life: 0.45,
          maxLife: 0.45,
          radius: p.splashRadius,
        });
        onSound?.('siege');
        for (const u of state.units) {
          if (u.owner === p.owner || u.hp <= 0) continue;
          const d = Math.hypot(u.x - p.targetX, u.y - p.targetY);
          if (d <= p.splashRadius) {
            const armor = UNIT_DEFS[u.type].armor + state.players[u.owner].armorUpgrade * 2;
            const dmg = Math.max(4, Math.round(p.damage * (1 - d / (p.splashRadius * 1.5)) - armor * 0.5));
            damageUnit(state, u, dmg, p.owner);
          }
        }
        for (const b of state.buildings) {
          if (b.owner === p.owner || b.hp <= 0) continue;
          const d = Math.hypot(b.x - p.targetX, b.y - p.targetY) - BUILDING_DEFS[b.type].size;
          if (d <= p.splashRadius) {
            damageBuilding(state, b, Math.round(p.damage * p.siegeBonus), p.owner);
          }
        }
      } else if (p.targetUnitId) {
        const tu = state.units.find((u) => u.id === p.targetUnitId && u.hp > 0);
        if (tu) {
          const armor = UNIT_DEFS[tu.type].armor + state.players[tu.owner].armorUpgrade * 2;
          const dmg = Math.max(2, p.damage - armor);
          damageUnit(state, tu, dmg, p.owner);
        }
      } else if (p.targetBuildingId) {
        const tb = state.buildings.find((b) => b.id === p.targetBuildingId && b.hp > 0);
        if (tb) {
          damageBuilding(state, tb, Math.round(p.damage * p.siegeBonus), p.owner);
        }
      }
      state.projectiles.splice(i, 1);
    }
  }

  // 5. Cleanup dead units & destroyed buildings
  state.units = state.units.filter((u) => u.hp > 0);
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    if (state.buildings[i].hp <= 0) {
      const deadB = state.buildings[i];
      state.effects.push({
        id: nextId('fx'),
        kind: 'explosion',
        x: deadB.x,
        y: deadB.y,
        life: 0.65,
        maxLife: 0.65,
        radius: BUILDING_DEFS[deadB.type].size + 15,
      });
      onSound?.('siege');
      state.buildings.splice(i, 1);
    }
  }

  // 6. Visual effects countdown
  for (let i = state.effects.length - 1; i >= 0; i--) {
    state.effects[i].life -= simDt;
    if (state.effects[i].life <= 0) {
      state.effects.splice(i, 1);
    }
  }

  // 7. Victory / Defeat Check (destroy all Town Centers & Castles, or all buildings)
  const p1Core = state.buildings.some(
    (b) => b.owner === 1 && (b.type === 'town_center' || b.type === 'castle')
  );
  const p2Core = state.buildings.some(
    (b) => b.owner === 2 && (b.type === 'town_center' || b.type === 'castle')
  );
  if (!p2Core) {
    state.winner = 1;
    state.winReason = `${state.players[1].name} menghancurkan pusat Kerajaan ${state.players[2].name}!`;
    onSound?.('victory');
  } else if (!p1Core) {
    state.winner = 2;
    state.winReason = `${state.players[2].name} menghancurkan pusat Kerajaan ${state.players[1].name}!`;
    onSound?.('defeat');
  }

  // 8. AI Commander
  if (enableAI && !state.winner) {
    updateAICommander(state, simDt);
  }

  // 9. Update Fog of War periodically (every 3 ticks)
  if (state.tick % 3 === 0) {
    updateFogOfWar(state);
  }
}

function moveUnitTowards(
  state: GameState,
  u: Unit,
  tx: number,
  ty: number,
  speed: number,
  dt: number,
  checkWalls: boolean
): Building | null {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return null;

  const nx = dx / dist;
  const ny = dy / dist;
  u.facing = Math.atan2(ny, nx);
  u.animPhase += dt * 11;

  const stepX = nx * speed * dt;
  const stepY = ny * speed * dt;
  const candX = Math.max(24, Math.min(state.mapWidth - 24, u.x + stepX));
  const candY = Math.max(24, Math.min(state.mapHeight - 24, u.y + stepY));

  if (isWaterBlocked(state, candX, candY)) {
    // Try steering toward nearest bridge
    const bridge = state.terrain.find((t) => t.kind === 'bridge');
    if (bridge) {
      const bx = bridge.x + bridge.w / 2;
      const by = bridge.y + bridge.h / 2;
      const bAngle = Math.atan2(by - u.y, bx - u.x);
      u.x += Math.cos(bAngle) * speed * dt;
      u.y += Math.sin(bAngle) * speed * dt;
    }
    return null;
  }

  if (checkWalls) {
    for (const b of state.buildings) {
      if (!b.built && b.owner === u.owner) continue;
      if (b.type === 'farm') continue;
      // Friendly unlocked gates allow passage
      if (b.type === 'gate' && b.owner === u.owner && !b.gateLocked) continue;

      const bSize = BUILDING_DEFS[b.type].size + 6;
      if (Math.abs(candX - b.x) < bSize && Math.abs(candY - b.y) < bSize) {
        if (b.owner !== u.owner && (b.type === 'wall' || b.type === 'gate')) {
          return b; // Blocked by enemy fortress wall/gate -> can attack it!
        }
        // Slide around friendly or non-wall building
        const slideX = Math.abs(u.x - b.x) > Math.abs(u.y - b.y) ? 0 : Math.sign(candX - b.x || 1) * speed * dt * 0.8;
        const slideY = Math.abs(u.y - b.y) > Math.abs(u.x - b.x) ? 0 : Math.sign(candY - b.y || 1) * speed * dt * 0.8;
        u.x = Math.max(24, Math.min(state.mapWidth - 24, u.x + slideX));
        u.y = Math.max(24, Math.min(state.mapHeight - 24, u.y + slideY));
        return null;
      }
    }
  }

  u.x = candX;
  u.y = candY;
  return null;
}

function performUnitAttackOnUnit(
  state: GameState,
  attacker: Unit,
  target: Unit,
  aDef: ReturnType<typeof getUnitDisplayDef>,
  onSound?: (kind: 'build' | 'arrow' | 'sword' | 'siege' | 'victory' | 'defeat') => void
): void {
  const pAtt = state.players[attacker.owner];
  const pTar = state.players[target.owner];
  let dmg = aDef.attack + pAtt.attackUpgrade * 2;
  if (target.type === 'cavalry' || (target.type === 'unique' && pTar.faction === 'byzantium')) {
    dmg = Math.round(dmg * aDef.cavBonus);
  }

  if (aDef.isRanged) {
    state.projectiles.push({
      id: nextId('p'),
      owner: attacker.owner,
      x: attacker.x,
      y: attacker.y - 10,
      startX: attacker.x,
      startY: attacker.y - 10,
      targetX: target.x,
      targetY: target.y,
      targetUnitId: target.id,
      targetBuildingId: null,
      progress: 0,
      speed: attacker.type === 'catapult' ? 320 : 480,
      damage: dmg,
      siegeBonus: aDef.siegeBonus,
      splashRadius: aDef.splashRadius || 0,
      kind: attacker.type === 'catapult' ? 'boulder' : 'arrow',
    });
    onSound?.('arrow');
  } else {
    const armor = UNIT_DEFS[target.type].armor + pTar.armorUpgrade * 2;
    const finalDmg = Math.max(2, dmg - armor);
    damageUnit(state, target, finalDmg, attacker.owner);
    state.effects.push({
      id: nextId('fx'),
      kind: 'slash',
      x: target.x,
      y: target.y - 6,
      life: 0.2,
      maxLife: 0.2,
    });
    onSound?.('sword');
  }
}

function performUnitAttackOnBuilding(
  state: GameState,
  attacker: Unit,
  target: Building,
  aDef: ReturnType<typeof getUnitDisplayDef>,
  onSound?: (kind: 'build' | 'arrow' | 'sword' | 'siege' | 'victory' | 'defeat') => void
): void {
  const pAtt = state.players[attacker.owner];
  const ottomanSiegeMult =
    pAtt.faction === 'ottoman' && (attacker.type === 'ram' || attacker.type === 'catapult') ? 1.25 : 1;
  const rawDmg = Math.round((aDef.attack + pAtt.attackUpgrade * 2) * aDef.siegeBonus * ottomanSiegeMult);

  if (aDef.isRanged) {
    state.projectiles.push({
      id: nextId('p'),
      owner: attacker.owner,
      x: attacker.x,
      y: attacker.y - 10,
      startX: attacker.x,
      startY: attacker.y - 10,
      targetX: target.x,
      targetY: target.y,
      targetUnitId: null,
      targetBuildingId: target.id,
      progress: 0,
      speed: attacker.type === 'catapult' ? 320 : 480,
      damage: aDef.attack + pAtt.attackUpgrade * 2,
      siegeBonus: aDef.siegeBonus * ottomanSiegeMult,
      splashRadius: aDef.splashRadius || 0,
      kind: attacker.type === 'catapult' ? 'boulder' : 'arrow',
    });
    onSound?.('arrow');
  } else {
    damageBuilding(state, target, rawDmg, attacker.owner);
    state.effects.push({
      id: nextId('fx'),
      kind: attacker.type === 'ram' ? 'dust' : 'slash',
      x: target.x + (Math.random() - 0.5) * 20,
      y: target.y + (Math.random() - 0.5) * 20,
      life: 0.25,
      maxLife: 0.25,
    });
    onSound?.(attacker.type === 'ram' ? 'siege' : 'sword');
  }
}

function damageUnit(state: GameState, target: Unit, dmg: number, attackerOwner: PlayerId): void {
  target.hp -= dmg;
  target.hitFlash = 0.16;
  if (target.hp <= 0) {
    state.players[attackerOwner].unitsKilled += 1;
    state.players[attackerOwner].score += 25;
  }
}

function damageBuilding(state: GameState, target: Building, dmg: number, attackerOwner: PlayerId): void {
  target.hp -= dmg;
  target.hitFlash = 0.18;
  if (target.owner === 1 && (!state.lastAlertP1 || state.elapsed - state.lastAlertP1.time > 10)) {
    state.lastAlertP1 = {
      text: `${BUILDING_DEFS[target.type].name} Anda sedang diserang!`,
      time: state.elapsed,
    };
  }
  if (target.hp <= 0) {
    state.players[attackerOwner].buildingsDestroyed += 1;
    state.players[attackerOwner].score += 110;
  }
}

export function updateFogOfWar(state: GameState): void {
  const resetVisibleToExplored = (fog: number[]) => {
    for (let i = 0; i < fog.length; i++) {
      if (fog[i] === 2) fog[i] = 1;
    }
  };
  resetVisibleToExplored(state.fogP1);
  resetVisibleToExplored(state.fogP2);

  const reveal = (fog: number[], x: number, y: number, range: number) => {
    const rCells = Math.ceil(range / FOG_CELL);
    const cx = Math.floor(x / FOG_CELL);
    const cy = Math.floor(y / FOG_CELL);
    const r2 = range * range;
    for (let gy = Math.max(0, cy - rCells); gy <= Math.min(state.fogRows - 1, cy + rCells); gy++) {
      for (let gx = Math.max(0, cx - rCells); gx <= Math.min(state.fogCols - 1, cx + rCells); gx++) {
        const wx = gx * FOG_CELL + FOG_CELL / 2;
        const wy = gy * FOG_CELL + FOG_CELL / 2;
        if ((wx - x) * (wx - x) + (wy - y) * (wy - y) <= r2) {
          fog[gy * state.fogCols + gx] = 2;
        }
      }
    }
  };

  for (const b of state.buildings) {
    const fog = b.owner === 1 ? state.fogP1 : state.fogP2;
    reveal(fog, b.x, b.y, BUILDING_DEFS[b.type].visionRange);
  }
  for (const u of state.units) {
    const fog = u.owner === 1 ? state.fogP1 : state.fogP2;
    reveal(fog, u.x, u.y, UNIT_DEFS[u.type].visionRange);
  }
}

function updateAICommander(state: GameState, dt: number): void {
  state.aiState.decisionTimer -= dt;
  if (state.aiState.decisionTimer > 0) return;

  const diff = state.aiState.difficulty;
  state.aiState.decisionTimer = diff === 'easy' ? 4.2 : diff === 'normal' ? 2.5 : 1.6;

  const ai = state.players[2];
  const aiTC = state.buildings.find((b) => b.owner === 2 && b.type === 'town_center');
  if (!aiTC) return;

  // Hard difficulty slight resource efficiency boost
  if (diff === 'hard') {
    ai.resources.food += 5;
    ai.resources.wood += 5;
    ai.resources.gold += 3;
    ai.resources.stone += 3;
  }

  const aiVillagers = state.units.filter((u) => u.owner === 2 && u.type === 'villager');
  const aiSoldiers = state.units.filter((u) => u.owner === 2 && u.type !== 'villager');
  const aiBuildings = state.buildings.filter((b) => b.owner === 2);

  // 1. Assign idle villagers to build or gather balanced resources
  const unfinished = aiBuildings.find((b) => !b.built);
  for (const v of aiVillagers) {
    if (v.state === 'idle') {
      if (unfinished) {
        applyGameCommand(state, {
          type: 'repair_or_build',
          playerId: 2,
          unitIds: [v.id],
          buildingId: unfinished.id,
        });
        continue;
      }
      const needType: ResourceType =
        ai.resources.food < 160
          ? 'food'
          : ai.resources.wood < 180
          ? 'wood'
          : ai.resources.gold < 130
          ? 'gold'
          : ai.resources.stone < 140
          ? 'stone'
          : (['wood', 'food', 'gold', 'stone'][Math.floor(Math.random() * 4)] as ResourceType);

      const node = state.resources
        .filter((r) => r.type === needType && r.amount > 0)
        .sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
      if (node) {
        applyGameCommand(state, { type: 'gather', playerId: 2, unitIds: [v.id], resourceId: node.id });
      }
    }
  }

  // 2. Train Villagers up to target
  const targetVillagers = diff === 'easy' ? 7 : diff === 'normal' ? 10 : 13;
  const pop = getPlayerPopStats(state, 2);
  if (aiVillagers.length < targetVillagers && aiTC.queue.length < 2 && pop.used < pop.cap) {
    applyGameCommand(state, { type: 'train_unit', playerId: 2, buildingId: aiTC.id, unitType: 'villager' });
  }

  // 3. Build House if near pop cap
  if (pop.cap - pop.used <= 3 && canAfford(ai.resources, BUILDING_DEFS.house.cost)) {
    for (let tries = 0; tries < 6; tries++) {
      const hx = snapToGrid(aiTC.x + (Math.random() - 0.5) * 420, 2);
      const hy = snapToGrid(aiTC.y + (Math.random() - 0.5) * 420, 2);
      if (canPlaceBuildingAt(state, 'house', hx, hy)) {
        applyGameCommand(state, {
          type: 'place_buildings',
          playerId: 2,
          buildingType: 'house',
          positions: [{ x: hx, y: hy }],
          builderUnitIds: aiVillagers.slice(0, 1).map((v) => v.id),
        });
        break;
      }
    }
  }

  // 4. Advance Age
  if (ai.age < 3 && !ai.ageAdvancing && aiVillagers.length >= 6) {
    const nextAge = (ai.age + 1) as 2 | 3;
    if (canAfford(ai.resources, AGE_ADVANCE_COST[nextAge])) {
      applyGameCommand(state, { type: 'advance_age', playerId: 2 });
    }
  }

  // 5. Build Economy & Military Buildings + Defensive Fortress Walls & Towers
  const hasType = (t: BuildingType) => aiBuildings.some((b) => b.type === t);
  const tryPlaceNearTC = (type: BuildingType, offsetX: number, offsetY: number) => {
    const def = BUILDING_DEFS[type];
    if (ai.age < def.minAge) return;
    if (!canAfford(ai.resources, getBuildingCost(type, ai.faction))) return;
    const px = snapToGrid(aiTC.x + offsetX, def.gridSpan);
    const py = snapToGrid(aiTC.y + offsetY, def.gridSpan);
    if (canPlaceBuildingAt(state, type, px, py)) {
      applyGameCommand(state, {
        type: 'place_buildings',
        playerId: 2,
        buildingType: type,
        positions: [{ x: px, y: py }],
        builderUnitIds: aiVillagers.slice(0, 2).map((v) => v.id),
      });
    }
  };

  if (!hasType('barracks')) tryPlaceNearTC('barracks', -192, 144);
  if (!hasType('farm')) tryPlaceNearTC('farm', 192, 144);
  if (ai.age >= 2) {
    if (!hasType('archery')) tryPlaceNearTC('archery', -288, 48);
    if (!hasType('stable')) tryPlaceNearTC('stable', -96, 288);
    if (aiBuildings.filter((b) => b.type === 'tower').length < 2) {
      tryPlaceNearTC('tower', -240, 240);
      tryPlaceNearTC('tower', -336, 144);
    }
    // Build defensive stone wall arc on south-west approach
    if (!state.aiState.wallBuilt && ai.resources.stone >= 120) {
      const wallPositions: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const wx = snapToGrid(aiTC.x - 288 + i * GRID_SIZE, 1);
        const wy = snapToGrid(aiTC.y + 240, 1);
        if (canPlaceBuildingAt(state, 'wall', wx, wy)) {
          wallPositions.push({ x: wx, y: wy });
        }
      }
      if (wallPositions.length >= 3) {
        applyGameCommand(state, {
          type: 'place_buildings',
          playerId: 2,
          buildingType: 'wall',
          positions: wallPositions,
          builderUnitIds: aiVillagers.slice(0, 2).map((v) => v.id),
        });
        state.aiState.wallBuilt = true;
      }
    }
  }
  if (ai.age >= 3) {
    if (!hasType('siege_workshop')) tryPlaceNearTC('siege_workshop', -240, -144);
    if (!hasType('castle')) tryPlaceNearTC('castle', -240, 144);
  }

  // 6. Train Military Units
  const barracks = aiBuildings.find((b) => b.type === 'barracks' && b.built);
  if (barracks && barracks.queue.length < 2) {
    const ut: UnitType = Math.random() > 0.4 ? 'militia' : 'spearman';
    applyGameCommand(state, { type: 'train_unit', playerId: 2, buildingId: barracks.id, unitType: ut });
  }
  const archery = aiBuildings.find((b) => b.type === 'archery' && b.built);
  if (archery && archery.queue.length < 2) {
    applyGameCommand(state, { type: 'train_unit', playerId: 2, buildingId: archery.id, unitType: 'archer' });
  }
  const stable = aiBuildings.find((b) => b.type === 'stable' && b.built);
  if (stable && stable.queue.length < 2) {
    applyGameCommand(state, { type: 'train_unit', playerId: 2, buildingId: stable.id, unitType: 'cavalry' });
  }
  const siege = aiBuildings.find((b) => b.type === 'siege_workshop' && b.built);
  if (siege && siege.queue.length < 1) {
    applyGameCommand(state, {
      type: 'train_unit',
      playerId: 2,
      buildingId: siege.id,
      unitType: Math.random() > 0.5 ? 'ram' : 'catapult',
    });
  }
  const castle = aiBuildings.find((b) => b.type === 'castle' && b.built);
  if (castle && castle.queue.length < 2) {
    applyGameCommand(state, { type: 'train_unit', playerId: 2, buildingId: castle.id, unitType: 'unique' });
  }

  // 7. Defend base if player units are near AI TC
  const intruders = state.units.filter((u) => u.owner === 1 && Math.hypot(u.x - aiTC.x, u.y - aiTC.y) < 520);
  if (intruders.length > 0 && aiSoldiers.length > 0) {
    const idleDefenders = aiSoldiers.filter((s) => s.state === 'idle');
    if (idleDefenders.length > 0) {
      applyGameCommand(state, {
        type: 'attack_unit',
        playerId: 2,
        unitIds: idleDefenders.map((s) => s.id),
        targetUnitId: intruders[0].id,
      });
      return;
    }
  }

  // 8. Launch attack waves when army reaches threshold
  const waveSize = diff === 'easy' ? 7 : diff === 'normal' ? 6 : 8;
  const readySquad = aiSoldiers.filter((s) => s.state === 'idle');
  if (readySquad.length >= waveSize) {
    state.aiState.waveCount += 1;
    const p1Target =
      state.buildings.find((b) => b.owner === 1 && b.type === 'town_center') ||
      state.buildings.find((b) => b.owner === 1);
    if (p1Target) {
      applyGameCommand(state, {
        type: 'attack_building',
        playerId: 2,
        unitIds: readySquad.map((s) => s.id),
        targetBuildingId: p1Target.id,
      });
    }
  }
}
