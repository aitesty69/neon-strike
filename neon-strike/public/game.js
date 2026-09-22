const socket = io();

const $ = id => document.getElementById(id);

let myId = null;
let roomCode = "";
let state = null;
let me = null;

const keys = Object.create(null);
let firing = false;
let locked = false;
let lastMove = 0;
let lastShotLocal = 0;
let yaw = 0;
let pitch = 0;

const remote = new Map();
const colliders = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1017);
scene.fog = new THREE.Fog(0x0a1017, 28, 100);

const camera = new THREE.PerspectiveCamera(
  76,
  window.innerWidth / window.innerHeight,
  0.05,
  140
);
camera.rotation.order = "YXZ";
camera.position.set(0, 1.6, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("game").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x1a1d22, 2.1));

const mainLight = new THREE.DirectionalLight(0xffffff, 2.8);
mainLight.position.set(10, 28, 10);
mainLight.castShadow = true;
scene.add(mainLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 50),
  new THREE.MeshStandardMaterial({
    color: 0x151b23,
    roughness: 0.94,
    metalness: 0.05
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const gun = new THREE.Group();
camera.add(gun);
scene.add(camera);

let gunBody, gunBarrel, gunSight;

function rebuildGunModel(weapon) {
  while (gun.children.length) gun.remove(gun.children[0]);

  const config = {
    pistol: { color: 0x7b818b, length: 0.52, width: 0.14 },
    ak47: { color: 0x9a5e32, length: 0.76, width: 0.16 },
    galil: { color: 0x34414c, length: 0.82, width: 0.15 },
    sniper: { color: 0x272a30, length: 1.05, width: 0.13 }
  }[weapon] || { color: 0x777, length: 0.6, width: 0.15 };

  gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(config.width, 0.17, config.length),
    new THREE.MeshStandardMaterial({
      color: config.color,
      metalness: 0.35,
      roughness: 0.55
    })
  );
  gunBody.position.set(0.28, -0.25, -0.55);

  gunBarrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.055, 0.42),
    new THREE.MeshStandardMaterial({
      color: 0x0a0d12,
      metalness: 0.7,
      roughness: 0.3
    })
  );
  gunBarrel.position.set(0.28, -0.23, -0.55 - config.length / 2);

  gunSight = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.08, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x565e68 })
  );
  gunSight.position.set(0.28, -0.13, -0.54);

  gun.add(gunBody, gunBarrel, gunSight);
}

rebuildGunModel("pistol");

let mapGroup = null;

function clearMap() {
  if (mapGroup) scene.remove(mapGroup);
  mapGroup = new THREE.Group();
  mapGroup.userData.seed = null;
  colliders.length = 0;
  scene.add(mapGroup);
}

function makeWall(w) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(w.w, w.h, w.d),
    new THREE.MeshStandardMaterial({
      color: 0x38414c,
      roughness: 0.86
    })
  );
  wall.position.set(w.x, w.h / 2, w.z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  mapGroup.add(wall);
}

function buildMap(map) {
  clearMap();
  if (!map) return;

  for (const w of map.walls) {
    makeWall(w);
    colliders.push(w);
  }

  const spawnData = [
    { team: "red", x: -32, color: 0xbd3347 },
    { team: "blue", x: 32, color: 0x3974cf }
  ];

  for (const s of spawnData) {
    const zone = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.06, 18),
      new THREE.MeshStandardMaterial({
        color: s.color,
        transparent: true,
        opacity: 0.2,
        emissive: s.color,
        emissiveIntensity: 0.22
      })
    );
    zone.position.set(s.x, 0.03, 0);
    mapGroup.add(zone);

    // Spawn barrier wall.
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 2.5, 18),
      new THREE.MeshStandardMaterial({
        color: s.color,
        transparent: true,
        opacity: 0.18,
        emissive: s.color,
        emissiveIntensity: 0.25
      })
    );
    barrier.position.set(
      s.team === "red" ? -26.9 : 26.9,
      1.25,
      0
    );
    mapGroup.add(barrier);
  }
}

function blocked(x, z) {
  const radius = 0.48;

  if (x < -38.7 || x > 38.7 || z < -23.7 || z > 23.7) {
    return true;
  }

  for (const w of colliders) {
    if (
      x > w.x - w.w / 2 - radius &&
      x < w.x + w.w / 2 + radius &&
      z > w.z - w.d / 2 - radius &&
      z < w.z + w.d / 2 + radius
    ) {
      return true;
    }
  }

  if (me) {
    const enemyTeam = me.team === "red" ? "blue" : "red";
    const s = enemyTeam === "red"
      ? { x: -32, w: 10, d: 18 }
      : { x: 32, w: 10, d: 18 };

    if (
      x > s.x - s.w / 2 - 0.4 &&
      x < s.x + s.w / 2 + 0.4 &&
      z > -s.d / 2 - 0.4 &&
      z < s.d / 2 + 0.4
    ) {
      return true;
    }
  }

  return false;
}

function createRemote(p) {
  const root = new THREE.Group();

  const color = p.team === "red" ? 0xd34a5c : 0x4f8cff;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.25, 0.42),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.85;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe0c3a6 })
  );
  head.position.y = 1.65;

  root.add(body, head);
  root.position.set(p.x, 0, p.z);
  root.castShadow = true;
  scene.add(root);

  return {
    root,
    target: new THREE.Vector3(p.x, 0, p.z),
    yaw: p.yaw || 0
  };
}

function updateRemotePlayers() {
  if (!state) return;

  const seen = new Set();

  for (const p of state.players) {
    if (p.id === myId) continue;

    seen.add(p.id);

    if (!remote.has(p.id)) {
      remote.set(p.id, createRemote(p));
    }

    const r = remote.get(p.id);
    r.target.set(p.x, 0, p.z);
    r.yaw = p.yaw || 0;
    r.root.visible = p.alive;
  }

  for (const [id, r] of remote) {
    if (!seen.has(id)) {
      scene.remove(r.root);
      remote.delete(id);
    }
  }
}

function smoothRemote(dt) {
  for (const r of remote.values()) {
    r.root.position.lerp(r.target, Math.min(1, dt * 12));
    r.root.rotation.y += (r.yaw - r.root.rotation.y) * Math.min(1, dt * 10);
  }
}

function updateHUD() {
  if (!state || !me) return;

  $("scoreRed").textContent = state.score.red;
  $("scoreBlue").textContent = state.score.blue;
  $("roundNum").textContent = state.round;

  const left = Math.max(
    0,
    Math.ceil((state.phaseEndsAt - Date.now()) / 1000)
  );

  $("roundTimer").textContent =
    state.phase === "buy" || state.phase === "round" ? left : "";

  $("phaseName").textContent =
    state.phase === "buy" ? "BUY" :
    state.phase === "round" ? "LIVE" :
    state.phase === "roundEnd" ? "ROUND END" :
    "";

  $("healthFill").style.width = `${Math.max(0, me.hp)}%`;
  $("money").textContent = me.money;
  $("weaponName").textContent = (me.weapon || "pistol").toUpperCase();
  $("grenades").textContent = `G × ${me.grenades || 0}`;

  if (me.ammo) {
    $("ammo").textContent = `${me.ammo.mag} / ${me.ammo.reserve}`;
  } else {
    $("ammo").textContent = "-";
  }

  $("buyPanel").classList.toggle("hidden", state.phase !== "buy");
  $("buyCountdown").textContent = left;
}

function setScreen(name) {
  $("menu").classList.toggle("hidden", name !== "menu");
  $("lobby").classList.toggle("hidden", name !== "lobby");
  $("game").classList.toggle("hidden", name !== "game");
}

function renderLobby() {
  if (!state) return;

  setScreen("lobby");

  $("roomCodeLabel").textContent = state.code;

  const reds = state.players.filter(p => p.team === "red");
  const blues = state.players.filter(p => p.team === "blue");

  $("redCount").textContent = `${reds.length}/5`;
  $("blueCount").textContent = `${blues.length}/5`;

  $("redList").innerHTML = reds.map(p =>
    `<div class="player">
      <span>${escapeHtml(p.name)}</span>
      <small>${p.bot ? "BOT" : "PLAYER"}</small>
    </div>`
  ).join("");

  $("blueList").innerHTML = blues.map(p =>
    `<div class="player">
      <span>${escapeHtml(p.name)}</span>
      <small>${p.bot ? "BOT" : "PLAYER"}</small>
    </div>`
  ).join("");

  $("hostText").textContent =
    state.hostId === myId ? "Jesteś hostem. Gdy wszyscy wybiorą strony, możesz wystartować." : "Czekamy na hosta.";

  $("startMatch").classList.toggle("hidden", state.hostId !== myId);
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    "\"": "&quot;", "'": "&#039;"
  })[c]);
}

function showFeed(text) {
  const el = document.createElement("div");
  el.className = "feedItem";
  el.textContent = text;
  $("feed").appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

function showRoundBanner(text, ms = 1800) {
  const el = $("roundBanner");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), ms);
}

function startMouseLock() {
  if ($("game").classList.contains("hidden")) return;
  if (!locked) document.body.requestPointerLock?.();
}

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === document.body;
});

document.addEventListener("mousemove", e => {
  if (!locked) return;

  yaw -= e.movementX * 0.0023;
  pitch -= e.movementY * 0.0023;
  const limit = Math.PI / 2 - 0.08;
  pitch = Math.max(-limit, Math.min(limit, pitch));

  camera.rotation.set(pitch, yaw, 0, "YXZ");
});

document.addEventListener("keydown", e => {
  keys[e.code] = true;

  if (e.code === "Digit1") equip("pistol");
  if (e.code === "Digit2") equip("ak47");
  if (e.code === "Digit3") equip("galil");
  if (e.code === "Digit4") equip("sniper");
  if (e.code === "KeyR") reload();
  if (e.code === "KeyG") throwGrenade();
});

document.addEventListener("keyup", e => {
  keys[e.code] = false;
});

document.addEventListener("mousedown", e => {
  if (e.button !== 0) return;

  if (!locked) {
    startMouseLock();
    return;
  }

  firing = true;
  shoot();
});

document.addEventListener("mouseup", e => {
  if (e.button === 0) firing = false;
});

function equip(weapon) {
  if (!me || !me.owned.includes(weapon)) return;
  socket.emit("switchWeapon", {
    room: roomCode,
    weapon
  });
}

function reload() {
  socket.emit("reload", { room: roomCode });
}

function throwGrenade() {
  if (!locked || !me || me.grenades <= 0) return;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  socket.emit("grenade", {
    room: roomCode,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z
  });
}

function shoot() {
  if (!locked || !me || !me.alive || state?.phase !== "round") return;

  const now = performance.now();
  if (now - lastShotLocal < 55) return;
  lastShotLocal = now;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  socket.emit("shoot", {
    room: roomCode,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z
  });

  if (gunBody) {
    gunBody.position.z = -0.58;
    setTimeout(() => {
      if (gunBody) gunBody.position.z = -0.55;
    }, 55);
  }
}

function movement(dt) {
  if (!me || !me.alive) return;

  if (state?.phase !== "buy" && state?.phase !== "round") return;

  let f = 0;
  let r = 0;

  if (keys.KeyW) f += 1;
  if (keys.KeyS) f -= 1;
  if (keys.KeyD) r += 1;
  if (keys.KeyA) r -= 1;

  const len = Math.hypot(f, r);
  if (!len) return;

  f /= len;
  r /= len;

  const speed = keys.ShiftLeft || keys.ShiftRight ? 8.4 : 5.8;

  const forward = new THREE.Vector3(
    -Math.sin(yaw),
    0,
    -Math.cos(yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(yaw),
    0,
    -Math.sin(yaw)
  );

  const dx = (forward.x * f + right.x * r) * speed * dt;
  const dz = (forward.z * f + right.z * r) * speed * dt;

  const nextX = camera.position.x + dx;
  const nextZ = camera.position.z + dz;

  if (!blocked(nextX, camera.position.z)) {
    camera.position.x = nextX;
  }

  if (!blocked(camera.position.x, nextZ)) {
    camera.position.z = nextZ;
  }

  camera.position.y = 1.6;
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  if (Date.now() - lastMove > 45) {
    socket.emit("move", {
      room: roomCode,
      x: camera.position.x,
      z: camera.position.z,
      yaw,
      pitch
    });
    lastMove = Date.now();
  }
}

$("createRoom").onclick = () => {
  $("menuError").textContent = "";
  socket.emit("createRoom", {
    name: $("playerName").value || "Player"
  });
};

$("joinRoom").onclick = () => {
  $("menuError").textContent = "";
  socket.emit("joinRoom", {
    code: $("roomCodeInput").value,
    name: $("playerName").value || "Player"
  });
};

$("pickRed").onclick = () => {
  socket.emit("selectTeam", {
    room: roomCode,
    team: "red"
  });
};

$("pickBlue").onclick = () => {
  socket.emit("selectTeam", {
    room: roomCode,
    team: "blue"
  });
};

$("startMatch").onclick = () => {
  socket.emit("startMatch", { room: roomCode });
};

$("copyCode").onclick = async () => {
  await navigator.clipboard?.writeText(roomCode);
};

$("copyRoomLink").onclick = async () => {
  await navigator.clipboard?.writeText(
    `${location.origin}/?room=${roomCode}`
  );
};

$("playAgain").onclick = () => {
  socket.emit("playAgain", { room: roomCode });
};

for (const button of document.querySelectorAll("[data-buy]")) {
  button.onclick = () => {
    socket.emit("buy", {
      room: roomCode,
      item: button.dataset.buy
    });
  };
}

$("game").addEventListener("click", () => {
  if (!locked) startMouseLock();
});

socket.on("connect", () => {
  myId = socket.id;

  const codeFromLink =
    new URLSearchParams(location.search).get("room") || "";

  if (codeFromLink) {
    $("roomCodeInput").value = codeFromLink.toUpperCase();
  }
});

socket.on("roomCreated", code => {
  roomCode = code;
});

socket.on("joinedRoom", code => {
  roomCode = code;
});

socket.on("errorMsg", msg => {
  $("menuError").textContent = msg;
});

socket.on("notice", showFeed);

socket.on("shotFx", fx => {
  if (fx.id === myId) return;

  if (fx.hit === "head") {
    showFeed("HEADSHOT");
  } else if (fx.hit === "body") {
    showFeed("TRAFIENIE");
  }
});

socket.on("grenadeFx", data => {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff9b29,
      transparent: true,
      opacity: 0.85
    })
  );

  sphere.position.set(data.x, data.y, data.z);
  scene.add(sphere);

  const started = performance.now();

  const anim = () => {
    const t = (performance.now() - started) / 400;
    sphere.scale.setScalar(1 + t * 3);
    sphere.material.opacity = Math.max(0, 0.85 * (1 - t));
    if (t < 1) requestAnimationFrame(anim);
    else scene.remove(sphere);
  };

  anim();
});

socket.on("state", next => {
  const wasPhase = state?.phase;
  state = next;

  me = state.players.find(p => p.id === myId) || null;

  if (state.phase === "lobby") {
    renderLobby();
    $("matchEnd").classList.add("hidden");
    return;
  }

  if (state.map && mapGroup?.userData.seed !== state.map.seed) {
    buildMap(state.map);
    mapGroup.userData.seed = state.map.seed;
  }

  if (state.phase === "matchEnd") {
    $("matchEnd").classList.remove("hidden");
    const won = state.winner === me?.team;
    $("endTitle").textContent = won ? "ZWYCIĘSTWO" : "PRZEGRANA";
    $("endTitle").style.color = won ? "#72e38c" : "#ff5b6f";
    $("endScore").textContent =
      `${state.score.red} : ${state.score.blue}`;
    return;
  }

  setScreen("game");
  $("matchEnd").classList.add("hidden");

  if (me) {
    const teleport =
      wasPhase !== state.phase ||
      state.phase === "buy" && !me.alive;

    if (teleport) {
      camera.position.set(me.x, 1.6, me.z);
      yaw = me.yaw || 0;
      pitch = me.pitch || 0;
      camera.rotation.set(pitch, yaw, 0, "YXZ");
    }

    if (me.weapon) rebuildGunModel(me.weapon);
  }

  updateRemotePlayers();

  if (wasPhase !== state.phase) {
    if (state.phase === "buy") showRoundBanner(`RUNDA ${state.round} — KUPUJ`, 1700);
    if (state.phase === "round") showRoundBanner(`RUNDA ${state.round} — START`, 1300);
    if (state.phase === "roundEnd") showRoundBanner(
      state.winner === "draw"
        ? "REMIS"
        : state.winner === me?.team
          ? "WYGRANA RUNDY"
          : "PRZEGRANA RUNDY",
      2400
    );
  }
});

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min(0.05, (now - (animate.last || now)) / 1000);
  animate.last = now;

  if (state?.phase === "buy" || state?.phase === "round") {
    movement(dt);
    if (firing && locked) shoot();
  }

  updateHUD();
  smoothRemote(dt);

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
