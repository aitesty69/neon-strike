const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PUBLIC = path.join(__dirname, "public");
app.use(express.static(PUBLIC));

const PORT = process.env.PORT || 3000;

const MAX_TEAM = 5;
const BUY_MS = 10_000;
const ROUND_MS = 60_000;
const ROUND_END_MS = 3_000;

const MAP = { width: 80, depth: 50, wallCount: 28 };

const SPAWNS = {
  red:  { x: -32, z: 0, w: 10, d: 18 },
  blue: { x:  32, z: 0, w: 10, d: 18 }
};

const WEAPONS = {
  pistol: {
    label: "PISTOL", price: 0, mag: 12, reserve: 48,
    fireDelay: 260, reload: 850, range: 85,
    body: 15, head: 90, color: 0x6f737c
  },
  ak47: {
    label: "AK-47", price: 2700, mag: 30, reserve: 90,
    fireDelay: 100, reload: 1650, range: 105,
    body: 20, head: 80, color: 0x9b5b2e
  },
  galil: {
    label: "GALIL", price: 2000, mag: 35, reserve: 105,
    fireDelay: 92, reload: 1700, range: 105,
    body: 20, head: 80, color: 0x33434f
  },
  sniper: {
    label: "SNIPER", price: 4750, mag: 5, reserve: 20,
    fireDelay: 1150, reload: 1900, range: 180,
    body: 95, head: 100, color: 0x25272c
  }
};

const GRENADE = { price: 300, max: 2, radius: 7 };

const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mapOverlap(a, b, pad = 0) {
  return (
    a.x - a.w / 2 < b.x + b.w / 2 + pad &&
    a.x + a.w / 2 > b.x - b.w / 2 - pad &&
    a.z - a.d / 2 < b.z + b.d / 2 + pad &&
    a.z + a.d / 2 > b.z - b.d / 2 - pad
  );
}

function generateMap(seed) {
  const r = rand(seed);
  const walls = [];
  const spawnZones = [SPAWNS.red, SPAWNS.blue];
  let attempts = 0;

  while (walls.length < MAP.wallCount && attempts++ < 3000) {
    const w = 2 + Math.floor(r() * 6);
    const d = 2 + Math.floor(r() * 7);
    const wall = {
      x: -34 + r() * 68,
      z: -19 + r() * 38,
      w, d,
      h: 2.2 + r() * 2.2
    };

    if (spawnZones.some(z => mapOverlap(wall, z, 3))) continue;
    if (walls.some(w2 => mapOverlap(wall, w2, 1.8))) continue;
    walls.push(wall);
  }

  // Guaranteed center cover so the arena is never completely empty.
  walls.push(
    { x: 0, z: -8, w: 8, d: 2.5, h: 3.2 },
    { x: 0, z: 8, w: 8, d: 2.5, h: 3.2 }
  );

  return { seed, walls };
}

function newRoom() {
  const code = makeCode();
  const room = {
    code,
    hostId: null,
    phase: "lobby",
    phaseEndsAt: 0,
    round: 0,
    score: { red: 0, blue: 0 },
    winner: null,
    map: null,
    buyTimer: null,
    roundTimer: null,
    roundEndTimer: null,
    matchEndTimer: null,
    players: new Map()
  };
  rooms.set(code, room);
  return room;
}

function makePlayer(id, name, team, bot = false) {
  const p = {
    id,
    name: name || "Player",
    team,
    bot,

    alive: true,
    hp: 100,

    x: 0, y: 1.6, z: 0,
    yaw: 0, pitch: 0,

    money: 4000,
    lossStreak: 0,
    kills: 0,
    deaths: 0,

    weapon: "pistol",
    owned: ["pistol"],
    ammo: {
      pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
      ak47: { mag: 0, reserve: 0 },
      galil: { mag: 0, reserve: 0 },
      sniper: { mag: 0, reserve: 0 }
    },
    grenades: 0,

    lastShot: 0,
    reloading: false,
    botShotAt: 0
  };
  return p;
}

function humanPlayers(room) {
  return [...room.players.values()].filter(p => !p.bot);
}

function teamCount(room, team) {
  return [...room.players.values()].filter(p => p.team === team).length;
}

function teamAlive(room, team) {
  return [...room.players.values()].some(p => p.team === team && p.alive);
}

function insideSpawn(x, z, team, margin = 0) {
  const s = SPAWNS[team];
  return (
    x >= s.x - s.w / 2 - margin &&
    x <= s.x + s.w / 2 + margin &&
    z >= s.z - s.d / 2 - margin &&
    z <= s.z + s.d / 2 + margin
  );
}

function safeSpawn(team, index) {
  const s = SPAWNS[team];
  const lanes = [-7, -3.5, 0, 3.5, 7];
  return {
    x: s.x,
    y: 1.6,
    z: lanes[index % lanes.length],
    yaw: team === "red" ? 0 : Math.PI
  };
}

function prepareForBuy(room) {
  let redIndex = 0;
  let blueIndex = 0;

  for (const p of room.players.values()) {
    const index = p.team === "red" ? redIndex++ : blueIndex++;

    // Dead players lose their purchased primary. Survivors keep it.
    if (!p.alive) {
      p.owned = ["pistol"];
      p.weapon = "pistol";
      p.ammo = {
        pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
        ak47: { mag: 0, reserve: 0 },
        galil: { mag: 0, reserve: 0 },
        sniper: { mag: 0, reserve: 0 }
      };
      p.grenades = 0;
    } else {
      for (const key of Object.keys(WEAPONS)) {
        if (p.owned.includes(key)) {
          p.ammo[key] = {
            mag: WEAPONS[key].mag,
            reserve: WEAPONS[key].reserve
          };
        }
      }
    }

    const spawn = safeSpawn(p.team, index);
    p.alive = true;
    p.hp = 100;
    p.x = spawn.x;
    p.y = spawn.y;
    p.z = spawn.z;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.reloading = false;
  }
}

function roomPublic(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    round: room.round,
    score: room.score,
    winner: room.winner,
    map: room.map,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      alive: p.alive,
      hp: p.hp,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      weapon: p.weapon,
      owned: p.owned,
      money: p.money,
      grenades: p.grenades,
      kills: p.kills,
      deaths: p.deaths,
      ammo: p.ammo[p.weapon]
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", roomPublic(room));
}

function notice(room, text) {
  io.to(room.code).emit("notice", text);
}

function clearTimers(room) {
  for (const k of ["buyTimer", "roundTimer", "roundEndTimer", "matchEndTimer"]) {
    if (room[k]) clearTimeout(room[k]);
    room[k] = null;
  }
}

function startBuy(room) {
  clearTimeout(room.buyTimer);
  clearTimeout(room.roundTimer);
  clearTimeout(room.roundEndTimer);

  room.round++;
  room.phase = "buy";
  room.phaseEndsAt = Date.now() + BUY_MS;
  room.winner = null;

  prepareForBuy(room);
  broadcast(room);

  room.buyTimer = setTimeout(() => startRound(room), BUY_MS);
}

function startRound(room) {
  if (!rooms.has(room.code)) return;

  room.phase = "round";
  room.phaseEndsAt = Date.now() + ROUND_MS;
  notice(room, `Runda ${room.round} START`);
  broadcast(room);

  room.roundTimer = setTimeout(() => finishRound(room, "time"), ROUND_MS);
}

function applyRoundEconomy(room, winningTeam) {
  for (const p of room.players.values()) {
    if (p.team === winningTeam) {
      p.money += 3000;
      p.lossStreak = 0;
    } else {
      p.lossStreak = Math.min(p.lossStreak + 1, 5);
      const reward = LOSS_BONUS[p.lossStreak - 1] || LOSS_BONUS[4];
      p.money += reward;
    }
  }
}

function finishRound(room, reason) {
  if (room.phase !== "round") return;

  clearTimeout(room.roundTimer);

  let winningTeam = null;

  if (reason === "elimination") {
    if (!teamAlive(room, "red")) winningTeam = "blue";
    else if (!teamAlive(room, "blue")) winningTeam = "red";
  } else {
    const redAlive = [...room.players.values()].filter(p => p.team === "red" && p.alive).length;
    const blueAlive = [...room.players.values()].filter(p => p.team === "blue" && p.alive).length;
    if (redAlive > blueAlive) winningTeam = "red";
    else if (blueAlive > redAlive) winningTeam = "blue";
  }

  if (winningTeam) {
    room.score[winningTeam]++;
    applyRoundEconomy(room, winningTeam);
    room.winner = winningTeam;
    notice(room, `${winningTeam === "red" ? "CZERWONI" : "NIEBIESCY"} wygrywają rundę`);
  } else {
    // Tie: both sides get a small consolation amount.
    for (const p of room.players.values()) p.money += 1000;
    room.winner = "draw";
    notice(room, "Remis — 1000$ dla każdego");
  }

  room.phase = "roundEnd";
  room.phaseEndsAt = Date.now() + ROUND_END_MS;
  broadcast(room);

  room.roundEndTimer = setTimeout(() => {
    if (room.score.red >= 10 || room.score.blue >= 10) {
      room.phase = "matchEnd";
      room.phaseEndsAt = 0;
      room.winner = room.score.red >= 10 ? "red" : "blue";
      broadcast(room);

      room.matchEndTimer = setTimeout(() => resetToLobby(room), 6500);
    } else {
      startBuy(room);
    }
  }, ROUND_END_MS);
}

function resetToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.phaseEndsAt = 0;
  room.round = 0;
  room.score = { red: 0, blue: 0 };
  room.winner = null;
  room.map = null;

  for (const [id, p] of room.players) {
    if (p.bot) room.players.delete(id);
    else {
      p.alive = true;
      p.hp = 100;
      p.money = 4000;
      p.lossStreak = 0;
      p.kills = 0;
      p.deaths = 0;
      p.owned = ["pistol"];
      p.weapon = "pistol";
      p.grenades = 0;
    }
  }

  notice(room, "Play again: wróciliście do tego samego lobby.");
  broadcast(room);
}

function fillBots(room) {
  let n = 1;
  for (const team of ["red", "blue"]) {
    while (teamCount(room, team) < MAX_TEAM) {
      const id = `bot-${room.code}-${n}`;
      const p = makePlayer(id, `BOT ${n}`, team, true);
      p.money = 99999;
      // Bots get varied loadouts for a bit more gameplay variety.
      if (n % 4 === 0) p.owned = ["pistol", "sniper"], p.weapon = "sniper";
      else if (n % 3 === 0) p.owned = ["pistol", "galil"], p.weapon = "galil";
      else p.owned = ["pistol", "ak47"], p.weapon = "ak47";
      for (const key of p.owned) {
        p.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      }
      room.players.set(id, p);
      n++;
    }
  }
}

function startMatch(room) {
  if (room.phase !== "lobby") return false;
  if (humanPlayers(room).length < 1) return false;

  fillBots(room);
  room.score = { red: 0, blue: 0 };
  room.round = 0;
  room.map = generateMap((Math.random() * 0xffffffff) >>> 0);
  startBuy(room);
  return true;
}

function wallBlocked(room, x, z, radius = 0.5) {
  if (!room.map) return false;
  const a = { x, z, w: radius * 2, d: radius * 2 };
  return room.map.walls.some(w => mapOverlap(a, w, 0));
}

function validPlayerPosition(room, p, x, z) {
  const maxX = MAP.width / 2 - 1.2;
  const maxZ = MAP.depth / 2 - 1.2;

  x = Math.max(-maxX, Math.min(maxX, x));
  z = Math.max(-maxZ, Math.min(maxZ, z));

  const enemyTeam = p.team === "red" ? "blue" : "red";
  if (insideSpawn(x, z, enemyTeam, 0.4)) {
    const s = SPAWNS[enemyTeam];
    x = enemyTeam === "red"
      ? s.x + s.w / 2 + 0.8
      : s.x - s.w / 2 - 0.8;
  }

  if (wallBlocked(room, x, z)) {
    return { x: p.x, z: p.z };
  }

  return { x, z };
}

function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

function rayWallHit(room, origin, dir, maxT) {
  // Conservative 2D wall test.
  for (const w of room.map?.walls || []) {
    const minX = w.x - w.w / 2 - 0.35;
    const maxX = w.x + w.w / 2 + 0.35;
    const minZ = w.z - w.d / 2 - 0.35;
    const maxZ = w.z + w.d / 2 + 0.35;

    let tx1 = -Infinity, tx2 = Infinity;
    let tz1 = -Infinity, tz2 = Infinity;

    if (Math.abs(dir.x) < 1e-8) {
      if (origin.x < minX || origin.x > maxX) continue;
    } else {
      tx1 = (minX - origin.x) / dir.x;
      tx2 = (maxX - origin.x) / dir.x;
    }

    if (Math.abs(dir.z) < 1e-8) {
      if (origin.z < minZ || origin.z > maxZ) continue;
    } else {
      tz1 = (minZ - origin.z) / dir.z;
      tz2 = (maxZ - origin.z) / dir.z;
    }

    const tmin = Math.max(Math.min(tx1, tx2), Math.min(tz1, tz2), 0);
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(tz1, tz2));

    if (tmax >= tmin && tmin <= maxT) return tmin;
  }

  return Infinity;
}

function lineIntersectsRect(origin, dir, rect, maxT) {
  let t0 = 0, t1 = maxT;
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minZ = rect.z - rect.d / 2;
  const maxZ = rect.z + rect.d / 2;

  for (const [o, d, min, max] of [
    [origin.x, dir.x, minX, maxX],
    [origin.z, dir.z, minZ, maxZ]
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return false;
      continue;
    }
    let a = (min - o) / d;
    let b = (max - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

function shotTarget(room, shooter, dir, range) {
  const origin = { x: shooter.x, y: shooter.y, z: shooter.z };

  // Never let fire pass through either enemy spawn box.
  const enemySpawn = SPAWNS[shooter.team === "red" ? "blue" : "red"];
  if (lineIntersectsRect(origin, dir, enemySpawn, range)) {
    return null;
  }

  const wallT = rayWallHit(room, origin, dir, range);
  let best = null;
  let bestT = Math.min(range, wallT);

  for (const target of room.players.values()) {
    if (!target.alive || target.id === shooter.id || target.team === shooter.team) continue;

    // Explicit spawn immunity.
    if (insideSpawn(target.x, target.z, target.team, 0.01)) continue;

    // Body capsule approximation + head sphere.
    const headT = raySphere(
      origin, dir,
      { x: target.x, y: 1.85, z: target.z },
      0.34
    );

    const bodyT = raySphere(
      origin, dir,
      { x: target.x, y: 1.10, z: target.z },
      0.55
    );

    const t = Math.min(headT, bodyT);
    if (!Number.isFinite(t) || t >= bestT) continue;

    best = {
      target,
      part: headT < bodyT ? "head" : "body",
      t
    };
    bestT = t;
  }

  return best;
}

function canShoot(p) {
  const w = WEAPONS[p.weapon];
  const a = p.ammo[p.weapon];
  return p.alive &&
    !p.reloading &&
    a &&
    a.mag > 0 &&
    Date.now() - p.lastShot >= w.fireDelay;
}

function shoot(room, shooter, dx, dy, dz) {
  if (room.phase !== "round" || !canShoot(shooter)) return;

  const w = WEAPONS[shooter.weapon];
  const a = shooter.ammo[shooter.weapon];

  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / len, y: dy / len, z: dz / len };

  shooter.lastShot = Date.now();
  a.mag--;

  const hit = shotTarget(room, shooter, dir, w.range);

  io.to(room.code).emit("shotFx", {
    id: shooter.id,
    weapon: shooter.weapon,
    hit: hit ? hit.part : null
  });

  if (!hit) return;

  const damage = hit.part === "head" ? w.head : w.body;
  hit.target.hp -= damage;

  if (hit.target.hp <= 0) {
    hit.target.hp = 0;
    killPlayer(room, shooter, hit.target, shooter.weapon);
  }

  broadcast(room);
}

function killPlayer(room, killer, victim, weapon) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;

  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.money += 300;
    notice(room, `${killer.name} +300$ za frag (${victim.name})`);
  }

  if (!teamAlive(room, victim.team)) {
    finishRound(room, "elimination");
  }
}

function buy(room, p, item) {
  if (room.phase !== "buy" || p.bot) return;

  if (item === "grenade") {
    if (p.money < GRENADE.price || p.grenades >= GRENADE.max) return;
    p.money -= GRENADE.price;
    p.grenades++;
    broadcast(room);
    return;
  }

  if (!WEAPONS[item] || item === "pistol") return;

  const w = WEAPONS[item];
  if (p.money < w.price) return;

  p.money -= w.price;
  if (!p.owned.includes(item)) p.owned.push(item);
  p.weapon = item;
  p.ammo[item] = { mag: w.mag, reserve: w.reserve };
  broadcast(room);
}

function switchWeapon(p, key) {
  if (!p.alive || !p.owned.includes(key)) return;
  p.weapon = key;
  p.reloading = false;
  broadcast(roomOf(p.id));
}

function reload(p, room) {
  if (!p.alive || p.reloading) return;

  const w = WEAPONS[p.weapon];
  const a = p.ammo[p.weapon];
  if (!a || a.mag >= w.mag || a.reserve <= 0) return;

  p.reloading = true;

  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    const need = w.mag - a.mag;
    const taken = Math.min(need, a.reserve);
    a.mag += taken;
    a.reserve -= taken;
    p.reloading = false;
    broadcast(room);
  }, w.reload);
}

function roomOf(playerId) {
  for (const room of rooms.values()) {
    if (room.players.has(playerId)) return room;
  }
  return null;
}

function grenade(room, p, dx, dy, dz) {
  if (room.phase !== "round" || !p.alive || p.grenades <= 0) return;

  p.grenades--;

  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / len, y: dy / len, z: dz / len };

  const gx = p.x + dir.x * 9;
  const gz = p.z + dir.z * 9;

  io.to(room.code).emit("grenadeFx", { x: gx, y: 0.6, z: gz });

  for (const target of room.players.values()) {
    if (!target.alive || target.team === p.team) continue;
    if (insideSpawn(target.x, target.z, target.team, 0.01)) continue;

    const d = Math.hypot(target.x - gx, target.z - gz);
    if (d > GRENADE.radius) continue;

    const damage = Math.max(15, Math.round(85 - d * 10));
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      killPlayer(room, p, target, "grenade");
    }
  }

  broadcast(room);
}

function botTick(room) {
  if (room.phase !== "round") return;

  const bots = [...room.players.values()].filter(p => p.bot && p.alive);

  for (const bot of bots) {
    const enemies = [...room.players.values()].filter(
      p => p.alive && p.team !== bot.team && !insideSpawn(p.x, p.z, p.team, 0.01)
    );
    if (!enemies.length) continue;

    enemies.sort((a, b) => {
      return Math.hypot(a.x - bot.x, a.z - bot.z) -
             Math.hypot(b.x - bot.x, b.z - bot.z);
    });

    const target = enemies[0];
    let dx = target.x - bot.x;
    let dz = target.z - bot.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;

    if (d > 18) {
      const speed = 0.34;
      const next = validPlayerPosition(room, bot, bot.x + dx * speed, bot.z + dz * speed);
      bot.x = next.x;
      bot.z = next.z;
    } else {
      const side = Math.sin(Date.now() / 500 + bot.id.length) > 0 ? 1 : -1;
      const next = validPlayerPosition(
        room,
        bot,
        bot.x - dz * 0.18 * side,
        bot.z + dx * 0.18 * side
      );
      bot.x = next.x;
      bot.z = next.z;
    }

    bot.yaw = Math.atan2(dx, dz);
    bot.pitch = -0.03;

    const interval = bot.weapon === "sniper" ? 1450 : 360;
    if (d < (bot.weapon === "sniper" ? 75 : 62) && Date.now() - bot.botShotAt > interval) {
      bot.botShotAt = Date.now();

      // Bots mostly aim body-height; every few shots they get a head-height aim.
      const aimHead = Math.random() < 0.18;
      const targetY = aimHead ? 1.82 : 1.15;
      const vx = target.x - bot.x;
      const vy = targetY - 1.6;
      const vz = target.z - bot.z;
      shoot(room, bot, vx, vy, vz);
    }
  }
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }) => {
    const room = newRoom();
    const p = makePlayer(socket.id, String(name || "Player").slice(0, 18), "red");

    room.hostId = socket.id;
    room.players.set(socket.id, p);
    socket.join(room.code);

    socket.emit("roomCreated", room.code);
    broadcast(room);
  });

  socket.on("joinRoom", ({ code, name }) => {
    const room = rooms.get(String(code || "").toUpperCase().trim());

    if (!room) return socket.emit("errorMsg", "Nie znaleziono pokoju.");
    if (room.phase !== "lobby") return socket.emit("errorMsg", "Mecz już trwa.");
    if (humanPlayers(room).length >= MAX_TEAM * 2) {
      return socket.emit("errorMsg", "Lobby jest pełne.");
    }

    const red = teamCount(room, "red");
    const blue = teamCount(room, "blue");
    const team = blue < red ? "blue" : "red";

    room.players.set(
      socket.id,
      makePlayer(socket.id, String(name || "Player").slice(0, 18), team)
    );

    socket.join(room.code);
    socket.emit("joinedRoom", room.code);
    broadcast(room);
  });

  socket.on("selectTeam", ({ room: code, team }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (!room || !p || room.phase !== "lobby") return;
    if (team !== "red" && team !== "blue") return;
    if (teamCount(room, team) >= MAX_TEAM) return socket.emit("errorMsg", "Ta drużyna jest pełna.");

    p.team = team;
    broadcast(room);
  });

  socket.on("startMatch", ({ room: code }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;

    if (!startMatch(room)) {
      socket.emit("errorMsg", "Nie udało się uruchomić meczu.");
      return;
    }

    broadcast(room);
  });

  socket.on("buy", ({ room: code, item }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (room && p) buy(room, p, item);
  });

  socket.on("switchWeapon", ({ room: code, weapon }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    switchWeapon(p, weapon);
  });

  socket.on("reload", ({ room: code }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (room && p) reload(p, room);
  });

  socket.on("move", ({ room: code, x, z, yaw, pitch }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.alive) return;

    if (room.phase !== "buy" && room.phase !== "round") return;

    const pos = validPlayerPosition(room, p, Number(x) || 0, Number(z) || 0);

    p.x = pos.x;
    p.z = pos.z;
    p.yaw = Number(yaw) || 0;
    p.pitch = Number(pitch) || 0;
  });

  socket.on("shoot", ({ room: code, dx, dy, dz }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (!room || !p) return;

    shoot(
      room,
      p,
      Number(dx) || 0,
      Number(dy) || 0,
      Number(dz) || 1
    );
  });

  socket.on("grenade", ({ room: code, dx, dy, dz }) => {
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);
    if (!room || !p) return;

    grenade(
      room,
      p,
      Number(dx) || 0,
      Number(dy) || 0,
      Number(dz) || 1
    );
  });

  socket.on("playAgain", ({ room: code }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.phase !== "matchEnd") return;
    resetToLobby(room);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const old = room.players.get(socket.id);
      if (!old) continue;

      room.players.delete(socket.id);

      if (room.hostId === socket.id) {
        room.hostId = humanPlayers(room)[0]?.id || null;
      }

      if (room.players.size === 0) {
        clearTimers(room);
        rooms.delete(room.code);
        continue;
      }

      // During a live match, replace a disconnected human with a bot.
      if (room.phase === "buy" || room.phase === "round" || room.phase === "roundEnd") {
        const bot = makePlayer(
          `bot-${room.code}-${Math.floor(Math.random() * 1e9)}`,
          `BOT REPLACEMENT`,
          old.team,
          true
        );
        bot.money = 99999;
        bot.owned = ["pistol", "ak47"];
        bot.weapon = "ak47";
        bot.ammo.ak47 = { mag: WEAPONS.ak47.mag, reserve: WEAPONS.ak47.reserve };

        room.players.set(bot.id, bot);

        if (room.phase === "round") {
          const index = teamCount(room, old.team) - 1;
          const spawn = safeSpawn(old.team, Math.max(0, index));
          bot.x = spawn.x;
          bot.z = spawn.z;
          bot.yaw = spawn.yaw;
        }
      }

      broadcast(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === "round") botTick(room);
  }
}, 120);

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size) broadcast(room);
  }
}, 100);

server.listen(PORT, () => {
  console.log(`NEON STRIKE running on http://localhost:${PORT}`);
});
