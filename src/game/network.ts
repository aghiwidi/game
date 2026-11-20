import Peer, { DataConnection } from 'peerjs';
import { FactionId, GameCommand, GameState, MapStyle } from './types';

export interface LobbyJoinInfo {
  guestName: string;
  guestFaction: FactionId;
}

export interface HostSetupInfo {
  hostName: string;
  hostFaction: FactionId;
  mapStyle: MapStyle;
}

export type NetPacket =
  | { kind: 'hello'; payload: LobbyJoinInfo }
  | { kind: 'start_game'; payload: { state: GameState; hostInfo: HostSetupInfo } }
  | { kind: 'cmd'; payload: GameCommand }
  | { kind: 'state'; payload: GameState }
  | { kind: 'ping'; t: number }
  | { kind: 'pong'; t: number };

export interface TransportCallbacks {
  onStatus: (status: string) => void;
  onConnected: (peerName?: string, peerFaction?: FactionId) => void;
  onStartGame: (initialState: GameState) => void;
  onRemoteCommand: (cmd: GameCommand) => void;
  onRemoteState: (state: GameState) => void;
  onPingUpdate: (rttMs: number) => void;
  onDisconnect: (reason: string) => void;
}

export interface GameTransport {
  sendCommand(cmd: GameCommand): void;
  broadcastState(state: GameState): void;
  sendStartGame(state: GameState, hostInfo: HostSetupInfo): void;
  destroy(): void;
}

export function generateRoomCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `KERAJAAN-${num}`;
}

export class LocalTabTransport implements GameTransport {
  private channel: BroadcastChannel;
  private isHost: boolean;
  private callbacks: TransportCallbacks;
  private pingTimer: number | null = null;

  constructor(
    roomCode: string,
    isHost: boolean,
    joinInfo: LobbyJoinInfo | null,
    callbacks: TransportCallbacks
  ) {
    this.isHost = isHost;
    this.callbacks = callbacks;
    this.channel = new BroadcastChannel(`takhta_benteng_${roomCode.toUpperCase()}`);

    this.channel.onmessage = (ev: MessageEvent<NetPacket>) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.kind === 'hello' && this.isHost) {
        this.callbacks.onConnected(msg.payload.guestName, msg.payload.guestFaction);
      } else if (msg.kind === 'start_game' && !this.isHost) {
        this.callbacks.onStartGame(msg.payload.state);
      } else if (msg.kind === 'cmd' && this.isHost) {
        this.callbacks.onRemoteCommand(msg.payload);
      } else if (msg.kind === 'state' && !this.isHost) {
        this.callbacks.onRemoteState(msg.payload);
      } else if (msg.kind === 'ping') {
        this.post({ kind: 'pong', t: msg.t });
      } else if (msg.kind === 'pong') {
        this.callbacks.onPingUpdate(Math.max(1, Math.round(performance.now() - msg.t)));
      }
    };

    if (!isHost && joinInfo) {
      this.callbacks.onStatus('Menghubungi tab Host lokal...');
      setTimeout(() => {
        this.post({ kind: 'hello', payload: joinInfo });
        this.callbacks.onConnected();
      }, 150);
    } else {
      this.callbacks.onStatus('Menunggu tab Lawan bergabung di kode ruang yang sama...');
    }

    this.pingTimer = window.setInterval(() => {
      this.post({ kind: 'ping', t: performance.now() });
    }, 2500);
  }

  private post(packet: NetPacket): void {
    try {
      this.channel.postMessage(packet);
    } catch {
      // channel closed
    }
  }

  sendCommand(cmd: GameCommand): void {
    if (!this.isHost) {
      this.post({ kind: 'cmd', payload: cmd });
    }
  }

  broadcastState(state: GameState): void {
    if (this.isHost) {
      this.post({ kind: 'state', payload: state });
    }
  }

  sendStartGame(state: GameState, hostInfo: HostSetupInfo): void {
    if (this.isHost) {
      this.post({ kind: 'start_game', payload: { state, hostInfo } });
    }
  }

  destroy(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.channel.close();
  }
}

export class PeerWebRTCTransport implements GameTransport {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private isHost: boolean;
  private callbacks: TransportCallbacks;
  private pingTimer: number | null = null;

  constructor(
    roomCode: string,
    isHost: boolean,
    joinInfo: LobbyJoinInfo | null,
    callbacks: TransportCallbacks
  ) {
    this.isHost = isHost;
    this.callbacks = callbacks;
    const peerId = isHost ? `tb-${roomCode.toUpperCase()}` : undefined;

    this.callbacks.onStatus(
      isHost ? 'Membuka jaringan P2P WebRTC...' : `Menghubungkan ke ${roomCode.toUpperCase()}...`
    );

    this.peer = peerId ? new Peer(peerId) : new Peer();

    this.peer.on('open', () => {
      if (isHost) {
        this.callbacks.onStatus('Ruang P2P aktif. Bagikan Kode Ruang ke lawan Anda.');
      } else {
        const targetId = `tb-${roomCode.toUpperCase()}`;
        const conn = this.peer.connect(targetId, { reliable: true });
        this.setupConnection(conn, joinInfo);
      }
    });

    if (isHost) {
      this.peer.on('connection', (conn) => {
        if (this.conn) {
          conn.close();
          return;
        }
        this.setupConnection(conn, null);
      });
    }

    this.peer.on('error', (err) => {
      this.callbacks.onDisconnect(`Koneksi P2P gagal (${err.type || 'network'}).`);
    });
  }

  private setupConnection(conn: DataConnection, joinInfo: LobbyJoinInfo | null): void {
    this.conn = conn;
    conn.on('open', () => {
      this.callbacks.onStatus('Terhubung langsung via WebRTC!');
      if (!this.isHost && joinInfo) {
        conn.send({ kind: 'hello', payload: joinInfo } satisfies NetPacket);
        this.callbacks.onConnected();
      }
      this.pingTimer = window.setInterval(() => {
        if (this.conn?.open) {
          this.conn.send({ kind: 'ping', t: performance.now() } satisfies NetPacket);
        }
      }, 2500);
    });

    conn.on('data', (raw) => {
      const msg = raw as NetPacket;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'hello' && this.isHost) {
        this.callbacks.onConnected(msg.payload.guestName, msg.payload.guestFaction);
      } else if (msg.kind === 'start_game' && !this.isHost) {
        this.callbacks.onStartGame(msg.payload.state);
      } else if (msg.kind === 'cmd' && this.isHost) {
        this.callbacks.onRemoteCommand(msg.payload);
      } else if (msg.kind === 'state' && !this.isHost) {
        this.callbacks.onRemoteState(msg.payload);
      } else if (msg.kind === 'ping') {
        conn.send({ kind: 'pong', t: msg.t } satisfies NetPacket);
      } else if (msg.kind === 'pong') {
        this.callbacks.onPingUpdate(Math.max(1, Math.round(performance.now() - msg.t)));
      }
    });

    conn.on('close', () => {
      this.callbacks.onDisconnect('Lawan terputus dari ruang permainan.');
    });
  }

  sendCommand(cmd: GameCommand): void {
    if (!this.isHost && this.conn?.open) {
      this.conn.send({ kind: 'cmd', payload: cmd } satisfies NetPacket);
    }
  }

  broadcastState(state: GameState): void {
    if (this.isHost && this.conn?.open) {
      this.conn.send({ kind: 'state', payload: state } satisfies NetPacket);
    }
  }

  sendStartGame(state: GameState, hostInfo: HostSetupInfo): void {
    if (this.isHost && this.conn?.open) {
      this.conn.send({ kind: 'start_game', payload: { state, hostInfo } } satisfies NetPacket);
    }
  }

  destroy(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.conn?.close();
      this.peer.destroy();
    } catch {
      // ignore
    }
  }
}
