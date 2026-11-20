import React, { useEffect, useState } from 'react';
import {
  Castle,
  Copy,
  Check,
  Globe,
  Laptop,
  Shield,
  Swords,
  Trophy,
  BookOpen,
  X,
  Users,
  WifiOff,
} from 'lucide-react';
import { FACTIONS } from '../game/constants';
import {
  AIDifficulty,
  FactionId,
  GameMode,
  MapStyle,
  MatchStatsRecord,
} from '../game/types';
import { generateRoomCode } from '../game/network';
import { FactionCrest } from './FactionCrest';

export interface StartMatchConfig {
  mode: GameMode;
  playerName: string;
  playerFaction: FactionId;
  enemyFaction: FactionId;
  mapStyle: MapStyle;
  difficulty: AIDifficulty;
  roomCode: string;
}

interface TitleLobbyProps {
  onStartOffline: (config: StartMatchConfig) => void;
  onStartNetworkLobby: (config: StartMatchConfig) => void;
  lobbyStatus: string;
  peerConnected: boolean;
  connectedGuestName: string;
  isWaitingHost: boolean;
  onHostLaunchMatch: () => void;
  onCancelLobby: () => void;
  matchHistory: MatchStatsRecord[];
}

export const TitleLobby: React.FC<TitleLobbyProps> = ({
  onStartOffline,
  onStartNetworkLobby,
  lobbyStatus,
  peerConnected,
  connectedGuestName,
  isWaitingHost,
  onHostLaunchMatch,
  onCancelLobby,
  matchHistory,
}) => {
  const [playTab, setPlayTab] = useState<'offline' | 'p2p' | 'local'>('offline');
  const [roleTab, setRoleTab] = useState<'host' | 'guest'>('host');
  const [playerName, setPlayerName] = useState('Panglima');
  const [playerFaction, setPlayerFaction] = useState<FactionId>('majapahit');
  const [enemyFaction, setEnemyFaction] = useState<FactionId>('byzantium');
  const [mapStyle, setMapStyle] = useState<MapStyle>('valley');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('normal');
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);

  // Auto-detect ?room=CODE in URL for instant multiplayer invite links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setPlayTab('p2p');
      setRoleTab('guest');
      setJoinCode(roomParam.toUpperCase());
    }
  }, []);

  const wins = matchHistory.filter((m) => m.won).length;
  const total = matchHistory.length;

  const handleCopyInvite = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleLaunch = () => {
    if (playTab === 'offline') {
      onStartOffline({
        mode: 'offline_ai',
        playerName: playerName.trim() || 'Kerajaan Anda',
        playerFaction,
        enemyFaction,
        mapStyle,
        difficulty,
        roomCode: '',
      });
      return;
    }

    const mode: GameMode =
      playTab === 'p2p'
        ? roleTab === 'host'
          ? 'p2p_host'
          : 'p2p_guest'
        : roleTab === 'host'
        ? 'local_host'
        : 'local_guest';

    const code = (roleTab === 'host' ? roomCode : joinCode).trim().toUpperCase();
    if (!code) return;

    onStartNetworkLobby({
      mode,
      playerName: playerName.trim() || (roleTab === 'host' ? 'Tuan Rumah' : 'Penantang'),
      playerFaction,
      enemyFaction,
      mapStyle,
      difficulty,
      roomCode: code,
    });
  };

  return (
    <div className="min-h-screen w-full bg-[#0F1218] text-[#F1EDE4] overflow-y-auto">
      {/* Top Bar Contract: 3 clean zones */}
      <header className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between gap-8 border-b border-white/8">
        <div className="flex items-center gap-3 shrink-0">
          <Castle className="w-6 h-6 text-amber-400" />
          <span className="font-display text-lg font-bold tracking-wide text-amber-100 whitespace-nowrap shrink-0">
            Takhta & Benteng
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-300">
          <button
            type="button"
            onClick={() => setPlayTab('offline')}
            className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 ${
              playTab === 'offline' ? 'text-amber-400 font-semibold' : ''
            }`}
          >
            Skirmish Offline
          </button>
          <button
            type="button"
            onClick={() => setPlayTab('p2p')}
            className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 ${
              playTab === 'p2p' ? 'text-amber-400 font-semibold' : ''
            }`}
          >
            Multiplayer P2P
          </button>
          <button
            type="button"
            onClick={() => setPlayTab('local')}
            className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 ${
              playTab === 'local' ? 'text-amber-400 font-semibold' : ''
            }`}
          >
            Lokal Antar Tab
          </button>
          <button
            type="button"
            onClick={() => setShowDeployModal(true)}
            className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
          >
            Deploy Cloudflare
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowDeployModal(true)}
            className="px-4 py-2 text-xs font-semibold bg-[#1B222D] hover:bg-[#242D3B] text-amber-200 border border-amber-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Panduan GitHub</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1280px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Hero & Faction Setup */}
        <section className="lg:col-span-7 space-y-6">
          <div className="space-y-3">
            <div className="text-xs text-amber-400/90 font-medium flex items-center gap-2">
              <span>Strategi Real-Time</span>
              <span aria-hidden="true">·</span>
              <span>Bangun Benteng & Pengepungan</span>
              <span aria-hidden="true">·</span>
              <span>Offline & Multiplayer</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-[#FAF6EE] leading-tight max-w-2xl">
              Bangun Bentengmu, Taklukkan Kerajaan Lawan
            </h1>
            <p className="text-slate-300 text-sm sm:text-base max-w-xl leading-relaxed">
              Kumpulkan kayu, pangan, emas, dan batu. Dirikan tembok batu memanjang, gerbang, dan menara panah secara real-time, lalu pimpin pasukan pengepungan meruntuhkan kastil musuh.
            </p>
          </div>

          {/* Faction Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Pilih Kerajaan Anda</h2>
              <span className="text-xs text-slate-400">3 Peradaban Unik</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(Object.keys(FACTIONS) as FactionId[]).map((fid) => {
                const f = FACTIONS[fid];
                const active = playerFaction === fid;
                return (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setPlayerFaction(fid)}
                    className={`text-left p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                      active
                        ? 'bg-[#1C2330] border-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.3)]'
                        : 'bg-[#151A22] border-white/8 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <FactionCrest faction={fid} size={44} />
                      <div className="min-w-0">
                        <div className="font-display text-sm font-bold text-amber-100 truncate">
                          {f.name}
                        </div>
                        <div className="text-xs text-slate-400 truncate">{f.subtitle}</div>
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-300 leading-snug">
                      {f.bonuses.map((bonus, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-amber-400 shrink-0">•</span>
                          <span>{bonus}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Map & Quick Guide Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-[#151A22] border border-white/8 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Shield className="w-4 h-4" />
                <span>Tembok Seret Real-Time</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Pilih Tembok Benteng lalu klik dan seret di peta untuk membangun barisan tembok batu seketika.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#151A22] border border-white/8 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Swords className="w-4 h-4" />
                <span>3 Zaman Kemajuan</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Naik dari Zaman Kegelapan ke Zaman Kastil untuk membuka Ketapel Batu, Pelantak Besi, dan Pasukan Elit.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#151A22] border border-white/8 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Trophy className="w-4 h-4" />
                <span>Rekor Pertempuran</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed font-mono-num">
                {total === 0
                  ? 'Belum ada pertempuran tercatat.'
                  : `${wins} Menang / ${total} Pertandingan`}
              </p>
            </div>
          </div>
        </section>

        {/* Right Column: Match Configuration & Multiplayer Panel */}
        <aside className="lg:col-span-5 bg-[#151A22] border border-white/10 rounded-2xl p-6 space-y-5">
          {/* Mode Segmented Control */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#0E1117] rounded-xl border border-white/6">
            <button
              type="button"
              onClick={() => {
                if (isWaitingHost) onCancelLobby();
                setPlayTab('offline');
              }}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                playTab === 'offline'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>Offline AI</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isWaitingHost) onCancelLobby();
                setPlayTab('p2p');
              }}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                playTab === 'p2p'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Online P2P</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isWaitingHost) onCancelLobby();
                setPlayTab('local');
              }}
              className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                playTab === 'local'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" />
              <span>Lokal Tab</span>
            </button>
          </div>

          {/* Player Name */}
          <div className="space-y-1.5">
            <label htmlFor="player-name" className="block text-xs font-medium text-slate-300">
              Nama Panglima / Kerajaan
            </label>
            <input
              id="player-name"
              type="text"
              maxLength={22}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0E1117] border border-white/12 text-sm text-white focus:outline-none focus:border-amber-500"
              placeholder="Contoh: Sultan Agung"
            />
          </div>

          {/* Map Selection */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-300">Peta Pertempuran</span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'valley', label: 'Lembah Terbuka' },
                  { id: 'river', label: 'Sungai & Jembatan' },
                  { id: 'highland', label: 'Dataran Tinggi' },
                ] as { id: MapStyle; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMapStyle(m.id)}
                  className={`py-2 px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap truncate ${
                    mapStyle === m.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                      : 'bg-[#0E1117] border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode-Specific Controls */}
          {playTab === 'offline' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-300">Kerajaan Lawan (AI)</span>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(FACTIONS) as FactionId[]).map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => setEnemyFaction(fid)}
                      className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors truncate ${
                        enemyFaction === fid
                          ? 'bg-red-500/15 border-red-500 text-red-200'
                          : 'bg-[#0E1117] border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {FACTIONS[fid].name.replace('Kerajaan ', '').replace('Kekaisaran ', '').replace('Kesultanan ', '')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-300">Tingkat Kesulitan AI</span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'easy', label: 'Mudah' },
                      { id: 'normal', label: 'Normal' },
                      { id: 'hard', label: 'Sulit' },
                    ] as { id: AIDifficulty; label: string }[]
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        difficulty === d.id
                          ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                          : 'bg-[#0E1117] border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLaunch}
                className="w-full py-3 px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Swords className="w-4 h-4" />
                <span>Mulai Pertempuran Offline</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-[#0E1117] border border-white/8 text-xs text-slate-300 leading-relaxed">
                {playTab === 'p2p'
                  ? 'Multiplayer P2P menggunakan WebRTC langsung antar browser tanpa server backend — berjalan penuh di Cloudflare Pages.'
                  : 'Mode Lokal Antar Tab berjalan 100% offline tanpa internet! Buka game ini di 2 tab browser yang sama lalu masukkan Kode Ruang yang sama.'}
              </div>

              {!isWaitingHost ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRoleTab('host')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                        roleTab === 'host'
                          ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                          : 'bg-[#0E1117] border-white/10 text-slate-400'
                      }`}
                    >
                      Buat Ruang (Host)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleTab('guest')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                        roleTab === 'guest'
                          ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                          : 'bg-[#0E1117] border-white/10 text-slate-400'
                      }`}
                    >
                      Gabung Ruang (Guest)
                    </button>
                  </div>

                  {roleTab === 'host' ? (
                    <div className="space-y-2">
                      <span className="block text-xs font-medium text-slate-300">Kode Ruang Anda</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={roomCode}
                          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                          className="flex-1 px-3.5 py-2 rounded-lg bg-[#0E1117] border border-white/12 text-sm font-mono-num text-amber-300 focus:outline-none focus:border-amber-500"
                        />
                        {playTab === 'p2p' && (
                          <button
                            type="button"
                            onClick={handleCopyInvite}
                            className="px-3 py-2 rounded-lg bg-[#1E2633] hover:bg-[#273142] text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
                          >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copied ? 'Tersalin' : 'Salin Link'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label htmlFor="join-code" className="block text-xs font-medium text-slate-300">
                        Masukkan Kode Ruang Host
                      </label>
                      <input
                        id="join-code"
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="Contoh: KERAJAAN-4829"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#0E1117] border border-white/12 text-sm font-mono-num text-amber-300 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={roleTab === 'guest' && !joinCode.trim()}
                    className="w-full py-3 px-5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Users className="w-4 h-4" />
                    <span>{roleTab === 'host' ? 'Buka Ruang Pertempuran' : 'Gabung ke Pertempuran'}</span>
                  </button>
                </>
              ) : (
                <div className="p-4 rounded-xl bg-[#0E1117] border border-amber-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">
                      Kode Ruang: <span className="font-mono-num">{roomCode}</span>
                    </span>
                    {playTab === 'p2p' && (
                      <button
                        type="button"
                        onClick={handleCopyInvite}
                        className="text-xs text-slate-300 hover:text-white flex items-center gap-1"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Tersalin' : 'Salin Link'}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-300">{lobbyStatus}</p>

                  {roleTab === 'host' && peerConnected && (
                    <div className="pt-1 space-y-2">
                      <div className="text-xs text-emerald-400 font-medium">
                        Lawan bergabung: {connectedGuestName || 'Penantang'}
                      </div>
                      <button
                        type="button"
                        onClick={onHostLaunchMatch}
                        className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
                      >
                        Mulai Pertempuran Sekarang
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onCancelLobby}
                    className="w-full py-2 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 transition-colors"
                  >
                    Batalkan Ruang
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>
      </main>

      {/* Recent Match History */}
      {matchHistory.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-6 pb-10">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Riwayat Pertempuran Terakhir</h2>
          <div className="overflow-x-auto rounded-xl border border-white/8 bg-[#151A22]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/8 text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Hasil</th>
                  <th className="py-2.5 px-4 font-medium">Mode</th>
                  <th className="py-2.5 px-4 font-medium">Kerajaan</th>
                  <th className="py-2.5 px-4 font-medium">Durasi</th>
                  <th className="py-2.5 px-4 font-medium">Pasukan Gugur (Lawan)</th>
                  <th className="py-2.5 px-4 font-medium">Bangunan Hancur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {matchHistory.slice(0, 6).map((m) => (
                  <tr key={m.id} className="text-slate-200">
                    <td className="py-2.5 px-4 font-semibold">
                      <span className={m.won ? 'text-emerald-400' : 'text-red-400'}>
                        {m.won ? 'Menang' : 'Kalah'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">{m.mode}</td>
                    <td className="py-2.5 px-4">
                      {FACTIONS[m.playerFaction].name} vs {FACTIONS[m.enemyFaction].name}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num">
                      {Math.floor(m.durationSec / 60)}m {Math.round(m.durationSec % 60)}d
                    </td>
                    <td className="py-2.5 px-4 font-mono-num">{m.unitsKilled}</td>
                    <td className="py-2.5 px-4 font-mono-num">{m.buildingsDestroyed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Cloudflare Pages & GitHub Deployment Modal */}
      {showDeployModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#151A22] border border-white/12 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-amber-200">
                Panduan Deploy GitHub & Cloudflare Pages
              </h3>
              <button
                type="button"
                onClick={() => setShowDeployModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Aplikasi ini dibangun 100% statis (Vite + React + HTML5 Canvas + WebRTC P2P) sehingga tidak memerlukan server Node.js saat dijalankan di Cloudflare Pages.
            </p>
            <ol className="space-y-2.5 text-xs text-slate-200 list-decimal pl-4 leading-relaxed">
              <li>
                Unggah seluruh kode proyek ini ke repository <strong>GitHub</strong> Anda.
              </li>
              <li>
                Buka dashboard <strong>Cloudflare Pages</strong>, pilih <em>Create application → Pages → Connect to Git</em>.
              </li>
              <li>
                Pilih repository GitHub Anda, lalu gunakan pengaturan build berikut:
                <div className="mt-1.5 p-2.5 rounded-lg bg-[#0E1117] border border-white/10 font-mono-num text-amber-300 space-y-1">
                  <div>Framework preset: Vite</div>
                  <div>Build command: npm run build</div>
                  <div>Build output directory: dist</div>
                </div>
              </li>
              <li>
                Klik <strong>Save and Deploy</strong>. Setelah live, mode <strong>Offline AI</strong>, <strong>Lokal Tab</strong>, dan <strong>Multiplayer P2P (WebRTC)</strong> langsung siap dimainkan!
              </li>
            </ol>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowDeployModal(false)}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
