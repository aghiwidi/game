import { useCallback, useEffect, useRef, useState } from 'react';
import { BattlefieldHUD } from './components/BattlefieldHUD';
import { StartMatchConfig, TitleLobby } from './components/TitleLobby';
import { FACTIONS } from './game/constants';
import {
  applyGameCommand,
  createInitialGameState,
  stepGameSimulation,
} from './game/engine';
import {
  GameTransport,
  LocalTabTransport,
  PeerWebRTCTransport,
} from './game/network';
import { soundFX } from './game/sound';
import {
  FactionId,
  GameCommand,
  GameMode,
  GameState,
  MatchStatsRecord,
  PlayerId,
} from './game/types';

const HISTORY_STORAGE_KEY = 'takhta_benteng_history_v1';

function loadMatchHistory(): MatchStatsRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [screen, setScreen] = useState<'lobby' | 'playing'>('lobby');
  const [mode, setMode] = useState<GameMode>('offline_ai');
  const [localPlayer, setLocalPlayer] = useState<PlayerId>(1);
  const [lastConfig, setLastConfig] = useState<StartMatchConfig | null>(null);
  const [matchHistory, setMatchHistory] = useState<MatchStatsRecord[]>(() => loadMatchHistory());

  // Network lobby state
  const [lobbyStatus, setLobbyStatus] = useState('');
  const [isWaitingHost, setIsWaitingHost] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [connectedGuestName, setConnectedGuestName] = useState('');
  const [connectedGuestFaction, setConnectedGuestFaction] = useState<FactionId>('byzantium');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);

  const stateRef = useRef<GameState | null>(null);
  const transportRef = useRef<GameTransport | null>(null);
  const recordedMatchRef = useRef(false);

  const cleanupTransport = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.destroy();
      transportRef.current = null;
    }
    setIsWaitingHost(false);
    setPeerConnected(false);
    setConnectedGuestName('');
    setPingMs(null);
  }, []);

  useEffect(() => {
    return () => cleanupTransport();
  }, [cleanupTransport]);

  const recordFinishedMatch = useCallback(
    (s: GameState, playerId: PlayerId, activeMode: GameMode) => {
      if (recordedMatchRef.current || !s.winner) return;
      recordedMatchRef.current = true;
      const me = s.players[playerId];
      const opp = s.players[playerId === 1 ? 2 : 1];
      const record: MatchStatsRecord = {
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        mode:
          activeMode === 'offline_ai'
            ? 'Offline AI'
            : activeMode === 'p2p_host' || activeMode === 'p2p_guest'
            ? 'Multiplayer P2P'
            : 'Lokal Tab',
        playerFaction: me.faction,
        enemyFaction: opp.faction,
        won: s.winner === playerId,
        durationSec: s.elapsed,
        unitsKilled: me.unitsKilled,
        buildingsDestroyed: me.buildingsDestroyed,
      };
      setMatchHistory((prev) => {
        const next = [record, ...prev].slice(0, 15);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
    },
    []
  );

  // Authoritative simulation loop for Offline AI, P2P Host, and Local Host
  useEffect(() => {
    if (screen !== 'playing') return;
    const isAuthoritative =
      mode === 'offline_ai' || mode === 'p2p_host' || mode === 'local_host';
    if (!isAuthoritative) return;

    let last = performance.now();
    let syncAccum = 0;

    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;

      const s = stateRef.current;
      if (!s) return;

      stepGameSimulation(s, dt, mode === 'offline_ai', (kind) => {
        if (kind === 'build') soundFX.playBuild();
        else if (kind === 'arrow') soundFX.playArrow();
        else if (kind === 'sword') soundFX.playSword();
        else if (kind === 'siege') soundFX.playSiegeHit();
        else if (kind === 'victory') soundFX.playFanfare(localPlayer === 1);
        else if (kind === 'defeat') soundFX.playFanfare(localPlayer === 2);
      });

      if (s.winner) {
        recordFinishedMatch(s, localPlayer, mode);
      }

      if ((mode === 'p2p_host' || mode === 'local_host') && transportRef.current) {
        syncAccum += dt;
        if (syncAccum >= 0.065) {
          syncAccum = 0;
          transportRef.current.broadcastState(s);
        }
      }
    }, 33); // ~30 ticks/sec

    return () => clearInterval(timer);
  }, [localPlayer, mode, recordFinishedMatch, screen]);

  // Guest winner check for recording history
  useEffect(() => {
    if (screen !== 'playing') return;
    if (mode !== 'p2p_guest' && mode !== 'local_guest') return;

    const timer = window.setInterval(() => {
      const s = stateRef.current;
      if (s?.winner && !recordedMatchRef.current) {
        soundFX.playFanfare(s.winner === localPlayer);
        recordFinishedMatch(s, localPlayer, mode);
      }
    }, 300);

    return () => clearInterval(timer);
  }, [localPlayer, mode, recordFinishedMatch, screen]);

  const handleStartOffline = (config: StartMatchConfig) => {
    cleanupTransport();
    soundFX.playClick();
    recordedMatchRef.current = false;
    setDisconnectNotice(null);
    setLastConfig(config);
    setMode('offline_ai');
    setLocalPlayer(1);

    stateRef.current = createInitialGameState({
      p1Name: config.playerName,
      p2Name: `AI ${FACTIONS[config.enemyFaction].name}`,
      p1Faction: config.playerFaction,
      p2Faction: config.enemyFaction,
      mapStyle: config.mapStyle,
      difficulty: config.difficulty,
    });
    setScreen('playing');
  };

  const handleStartNetworkLobby = (config: StartMatchConfig) => {
    cleanupTransport();
    soundFX.playClick();
    setDisconnectNotice(null);
    setLastConfig(config);
    setMode(config.mode);

    const isHost = config.mode === 'p2p_host' || config.mode === 'local_host';
    const isP2P = config.mode === 'p2p_host' || config.mode === 'p2p_guest';
    setLocalPlayer(isHost ? 1 : 2);
    setIsWaitingHost(true);
    setPeerConnected(false);

    const callbacks = {
      onStatus: (msg: string) => setLobbyStatus(msg),
      onConnected: (guestName?: string, guestFaction?: FactionId) => {
        setPeerConnected(true);
        if (guestName) setConnectedGuestName(guestName);
        if (guestFaction) setConnectedGuestFaction(guestFaction);
        setLobbyStatus(
          isHost
            ? 'Lawan terhubung! Klik Mulai Pertempuran Sekarang.'
            : 'Terhubung ke Host! Menunggu Host memulai pertempuran...'
        );
      },
      onStartGame: (initialState: GameState) => {
        recordedMatchRef.current = false;
        stateRef.current = initialState;
        setScreen('playing');
      },
      onRemoteCommand: (cmd: GameCommand) => {
        if (stateRef.current) {
          applyGameCommand(stateRef.current, cmd);
        }
      },
      onRemoteState: (remoteState: GameState) => {
        stateRef.current = remoteState;
      },
      onPingUpdate: (rtt: number) => setPingMs(rtt),
      onDisconnect: (reason: string) => {
        setLobbyStatus(reason);
        setDisconnectNotice(reason);
        setPeerConnected(false);
      },
    };

    const joinInfo = isHost
      ? null
      : { guestName: config.playerName, guestFaction: config.playerFaction };

    transportRef.current = isP2P
      ? new PeerWebRTCTransport(config.roomCode, isHost, joinInfo, callbacks)
      : new LocalTabTransport(config.roomCode, isHost, joinInfo, callbacks);
  };

  const handleHostLaunchMatch = () => {
    if (!lastConfig || !transportRef.current) return;
    soundFX.playFanfare(true);
    recordedMatchRef.current = false;
    const initialState = createInitialGameState({
      p1Name: lastConfig.playerName,
      p2Name: connectedGuestName || 'Penantang',
      p1Faction: lastConfig.playerFaction,
      p2Faction: connectedGuestFaction,
      mapStyle: lastConfig.mapStyle,
      difficulty: 'normal',
    });
    stateRef.current = initialState;
    transportRef.current.sendStartGame(initialState, {
      hostName: lastConfig.playerName,
      hostFaction: lastConfig.playerFaction,
      mapStyle: lastConfig.mapStyle,
    });
    setScreen('playing');
  };

  const handleDispatchCommand = useCallback(
    (cmd: GameCommand) => {
      if (mode === 'p2p_guest' || mode === 'local_guest') {
        transportRef.current?.sendCommand(cmd);
      } else if (stateRef.current) {
        applyGameCommand(stateRef.current, cmd);
      }
    },
    [mode]
  );

  const handleExitMatch = () => {
    cleanupTransport();
    stateRef.current = null;
    setScreen('lobby');
  };

  const handleRematch = () => {
    if (lastConfig && mode === 'offline_ai') {
      handleStartOffline(lastConfig);
    }
  };

  if (screen === 'lobby') {
    return (
      <TitleLobby
        onStartOffline={handleStartOffline}
        onStartNetworkLobby={handleStartNetworkLobby}
        lobbyStatus={lobbyStatus}
        peerConnected={peerConnected}
        connectedGuestName={connectedGuestName}
        isWaitingHost={isWaitingHost}
        onHostLaunchMatch={handleHostLaunchMatch}
        onCancelLobby={() => {
          cleanupTransport();
          setLobbyStatus('');
        }}
        matchHistory={matchHistory}
      />
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <BattlefieldHUD
        stateRef={stateRef}
        localPlayer={localPlayer}
        mode={mode}
        pingMs={pingMs}
        onDispatchCommand={handleDispatchCommand}
        onExitMatch={handleExitMatch}
        onRematch={handleRematch}
      />
      {disconnectNotice && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-red-900/95 border border-red-400/50 text-xs text-red-100 flex items-center gap-3">
          <span>{disconnectNotice}</span>
          <button
            type="button"
            onClick={handleExitMatch}
            className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 font-semibold"
          >
            Kembali ke Lobi
          </button>
        </div>
      )}
    </div>
  );
}
