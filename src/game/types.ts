export type FactionId = 'majapahit' | 'byzantium' | 'ottoman';

export type AgeLevel = 1 | 2 | 3;

export type ResourceType = 'wood' | 'food' | 'gold' | 'stone';

export interface Resources {
  wood: number;
  food: number;
  gold: number;
  stone: number;
}

export type BuildingType =
  | 'town_center'
  | 'house'
  | 'farm'
  | 'barracks'
  | 'archery'
  | 'stable'
  | 'siege_workshop'
  | 'blacksmith'
  | 'wall'
  | 'gate'
  | 'tower'
  | 'castle';

export type UnitType =
  | 'villager'
  | 'militia'
  | 'spearman'
  | 'archer'
  | 'cavalry'
  | 'ram'
  | 'catapult'
  | 'unique';

export type MapStyle = 'valley' | 'river' | 'highland';

export type GameMode = 'offline_ai' | 'p2p_host' | 'p2p_guest' | 'local_host' | 'local_guest';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type PlayerId = 1 | 2;

export interface FactionConfig {
  id: FactionId;
  name: string;
  subtitle: string;
  color: string;
  lightColor: string;
  darkColor: string;
  bonuses: string[];
  uniqueUnitName: string;
  uniqueUnitDesc: string;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  shortDesc: string;
  hotkey: string;
  cost: Partial<Resources>;
  maxHp: number;
  size: number; // world radius/half-width in px (grid snapping unit = 48px)
  gridSpan: number; // 1 for 48px wall/tower, 2 for 96px house/barracks, 3 for 144px TC/castle
  buildTime: number; // seconds
  minAge: AgeLevel;
  popBonus: number;
  visionRange: number;
  attackDamage?: number;
  attackRange?: number;
  attackCooldown?: number;
  trains?: UnitType[];
  category: 'economy' | 'military' | 'fortress';
}

export interface UnitDef {
  type: UnitType;
  name: string;
  shortDesc: string;
  hotkey: string;
  cost: Partial<Resources>;
  maxHp: number;
  speed: number; // px per sec
  attack: number;
  armor: number;
  range: number; // px
  attackCooldown: number; // seconds
  siegeBonus: number; // multiplier against buildings
  cavBonus: number; // multiplier against cavalry
  trainTime: number; // seconds
  minAge: AgeLevel;
  visionRange: number;
  radius: number;
  isRanged?: boolean;
  splashRadius?: number;
}

export interface ResourceNode {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  amount: number;
  maxAmount: number;
  radius: number;
  variant: number;
}

export interface TrainQueueItem {
  unitType: UnitType;
  remaining: number;
  total: number;
}

export interface Building {
  id: string;
  owner: PlayerId;
  type: BuildingType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  built: boolean;
  buildProgress: number; // 0 to 1
  attackTimer: number;
  queue: TrainQueueItem[];
  rallyX: number;
  rallyY: number;
  gateLocked?: boolean;
  /** Visual hit flash countdown */
  hitFlash: number;
}

export type UnitState =
  | 'idle'
  | 'moving'
  | 'gathering'
  | 'returning'
  | 'building'
  | 'attacking';

export interface Unit {
  id: string;
  owner: PlayerId;
  type: UnitType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  state: UnitState;
  targetX: number;
  targetY: number;
  targetUnitId: string | null;
  targetBuildingId: string | null;
  targetResourceId: string | null;
  carryType: ResourceType | null;
  carryAmount: number;
  attackTimer: number;
  gatherTimer: number;
  facing: number; // radians
  animPhase: number;
  hitFlash: number;
  stance: 'aggressive' | 'stand';
}

export interface Projectile {
  id: string;
  owner: PlayerId;
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetUnitId: string | null;
  targetBuildingId: string | null;
  progress: number; // 0 to 1
  speed: number;
  damage: number;
  siegeBonus: number;
  splashRadius: number;
  kind: 'arrow' | 'boulder' | 'cannon';
}

export interface VisualEffect {
  id: string;
  kind: 'slash' | 'explosion' | 'dust' | 'heal' | 'marker_move' | 'marker_attack' | 'float_text';
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text?: string;
  color?: string;
  radius?: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  faction: FactionId;
  age: AgeLevel;
  ageAdvancing: { targetAge: AgeLevel; remaining: number; total: number } | null;
  resources: Resources;
  attackUpgrade: number; // +2 per level (max 2)
  armorUpgrade: number; // +2 per level (max 2)
  score: number;
  unitsKilled: number;
  buildingsDestroyed: number;
  resourcesGathered: number;
}

export interface TerrainTile {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'water' | 'bridge' | 'highland' | 'road';
}

export interface GameState {
  tick: number;
  elapsed: number; // game seconds
  mapWidth: number;
  mapHeight: number;
  mapStyle: MapStyle;
  paused: boolean;
  speed: 1 | 1.5 | 2;
  winner: PlayerId | null;
  winReason: string | null;
  players: Record<PlayerId, PlayerState>;
  buildings: Building[];
  units: Unit[];
  resources: ResourceNode[];
  projectiles: Projectile[];
  effects: VisualEffect[];
  terrain: TerrainTile[];
  fogCols: number;
  fogRows: number;
  /** 0 = unexplored, 1 = explored, 2 = visible (stored per player for P1 & P2) */
  fogP1: number[];
  fogP2: number[];
  aiState: {
    difficulty: AIDifficulty;
    decisionTimer: number;
    waveCount: number;
    wallBuilt: boolean;
  };
  lastAlertP1: { text: string; time: number } | null;
  lastAlertP2: { text: string; time: number } | null;
}

export type GameCommand =
  | {
      type: 'move';
      playerId: PlayerId;
      unitIds: string[];
      x: number;
      y: number;
    }
  | {
      type: 'attack_unit';
      playerId: PlayerId;
      unitIds: string[];
      targetUnitId: string;
    }
  | {
      type: 'attack_building';
      playerId: PlayerId;
      unitIds: string[];
      targetBuildingId: string;
    }
  | {
      type: 'gather';
      playerId: PlayerId;
      unitIds: string[];
      resourceId: string;
    }
  | {
      type: 'repair_or_build';
      playerId: PlayerId;
      unitIds: string[];
      buildingId: string;
    }
  | {
      type: 'place_buildings';
      playerId: PlayerId;
      buildingType: BuildingType;
      positions: { x: number; y: number }[];
      builderUnitIds: string[];
    }
  | {
      type: 'train_unit';
      playerId: PlayerId;
      buildingId: string;
      unitType: UnitType;
    }
  | {
      type: 'cancel_train';
      playerId: PlayerId;
      buildingId: string;
      index: number;
    }
  | {
      type: 'advance_age';
      playerId: PlayerId;
    }
  | {
      type: 'upgrade_tech';
      playerId: PlayerId;
      tech: 'attack' | 'armor';
    }
  | {
      type: 'toggle_gate';
      playerId: PlayerId;
      buildingId: string;
    }
  | {
      type: 'demolish_building';
      playerId: PlayerId;
      buildingId: string;
    }
  | {
      type: 'set_rally';
      playerId: PlayerId;
      buildingId: string;
      x: number;
      y: number;
    }
  | {
      type: 'set_stance';
      playerId: PlayerId;
      unitIds: string[];
      stance: 'aggressive' | 'stand';
    }
  | {
      type: 'toggle_pause';
      playerId: PlayerId;
    }
  | {
      type: 'set_speed';
      playerId: PlayerId;
      speed: 1 | 1.5 | 2;
    };

export interface MatchStatsRecord {
  id: string;
  date: string;
  mode: string;
  playerFaction: FactionId;
  enemyFaction: FactionId;
  won: boolean;
  durationSec: number;
  unitsKilled: number;
  buildingsDestroyed: number;
}
