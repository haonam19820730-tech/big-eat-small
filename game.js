(() => {
  const WORLD = 3800;
  const FOOD_N = 170;
  const BOTS_SOLO = 13;
  const BOTS_MULTI = 7;
  const MAX_HUMANS = 8;
  const START_MASS = 16;
  const EAT_RATIO = 1.16;
  const FOOD_MIN = 1.2;
  const FOOD_MAX = 2.4;
  const BOOST_COST = 5.5;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const COLORS = [
    "#3dff9a", "#6d7cff", "#ff5b9a", "#ffd166", "#4cc9f0",
    "#80ed99", "#ff9f1c", "#c77dff", "#00f5d4", "#f72585",
  ];
  const BOT_NAMES = [
    "小魚", "豆豆", "閃電", "糯米", "泡泡", "鯊魚", "芒果",
    "幽靈", "企鵝", "布丁", "芝麻", "火箭", "雪球", "西瓜", "辣椒",
  ];

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });
  const $ = (id) => document.getElementById(id);
  const ui = {
    menu: $("menu"),
    join: $("join"),
    dead: $("dead"),
    hud: $("hud"),
    boost: $("boost"),
    stick: $("stick"),
    knob: $("knob"),
    board: $("board"),
    score: $("score"),
    mass: $("mass"),
    roomBar: $("roomBar"),
    roomCode: $("roomCode"),
    name: $("name"),
    joinCode: $("joinCode"),
    toast: $("toast"),
    deadTitle: $("deadTitle"),
    deadScore: $("deadScore"),
    deadHint: $("deadHint"),
  };

  let W = 0, H = 0, dpr = 1;
  let mode = "menu"; // menu | play | dead
  let netMode = "solo"; // solo | host | client
  let last = 0;
  let foodId = 1;
  let playerId = 1;

  const food = [];
  const players = [];
  let me = null;
  let cam = { x: WORLD / 2, y: WORLD / 2, z: 1 };
  let input = { angle: 0, boost: false, stickX: 0, stickY: 0 };
  let bestMass = START_MASS;
  let kills = 0;
  let roomCode = "";
  let peer = null;
  const conns = new Map();
  let foodDirty = true;
  let netAcc = 0;
  let toastTimer = 0;
  let respawnAt = 0;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function radius(mass) {
    return 13 + Math.sqrt(Math.max(1, mass)) * 2.55;
  }
  function speedOf(p) {
    const r = radius(p.mass);
    return (195 + 820 / r) * (p.boost ? 1.62 : 1);
  }
  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }
  function playerName() {
    const n = (ui.name.value || "").trim().slice(0, 8);
    return n || "玩家" + ((Math.random() * 90 + 10) | 0);
  }
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = (W * dpr) | 0;
    canvas.height = (H * dpr) | 0;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function emptySpot(r) {
    for (let i = 0; i < 30; i++) {
      const p = { x: rand(120, WORLD - 120), y: rand(120, WORLD - 120) };
      let ok = true;
      for (const o of players) {
        if (o.alive && dist(p, o) < r + radius(o.mass) + 40) { ok = false; break; }
      }
      if (ok) return p;
    }
    return { x: rand(200, WORLD - 200), y: rand(200, WORLD - 200) };
  }

  function addFood(x, y, value, color) {
    food.push({
      id: foodId++,
      x: x ?? rand(40, WORLD - 40),
      y: y ?? rand(40, WORLD - 40),
      value: value ?? rand(FOOD_MIN, FOOD_MAX),
      color: color || pick(COLORS),
      r: 3.2 + Math.random() * 2.4,
    });
    foodDirty = true;
  }

  function spawnPlayer(opts) {
    const pos = emptySpot(40);
    const p = {
      id: opts.id || playerId++,
      name: opts.name || pick(BOT_NAMES),
      color: opts.color || pick(COLORS),
      x: pos.x,
      y: pos.y,
      angle: rand(0, Math.PI * 2),
      mass: START_MASS,
      boost: false,
      alive: true,
      bot: !!opts.bot,
      human: !!opts.human,
      seek: rand(0, Math.PI * 2),
      seekT: 0,
      trail: [],
    };
    players.push(p);
    return p;
  }

  function resetWorld(botCount) {
    food.length = 0;
    players.length = 0;
    foodId = 1;
    playerId = 1;
    bestMass = START_MASS;
    kills = 0;
    foodDirty = true;
    for (let i = 0; i < FOOD_N; i++) addFood();
    me = spawnPlayer({ name: playerName(), human: true, color: COLORS[0] });
    for (let i = 0; i < botCount; i++) spawnPlayer({ bot: true });
    cam.x = me.x;
    cam.y = me.y;
    cam.z = 1;
    input.angle = me.angle;
  }

  function dropFoodFrom(p, keepRatio) {
    const n = clamp((p.mass * (1 - keepRatio) / 2) | 0, 6, 28);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(8, radius(p.mass) + 30);
      addFood(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rand(1.5, 3.2), p.color);
    }
  }

  function kill(victim, eater) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.boost = false;
    if (eater && eater.alive) {
      eater.mass += victim.mass * 0.55;
      if (eater === me) kills += 1;
    }
    dropFoodFrom(victim, 0.2);
    if (victim === me) {
      bestMass = Math.max(bestMass, me.mass);
      if (netMode === "solo") {
        showDead("你被吃掉了", Math.floor(bestMass), "這局最高體型");
      } else {
        toast(eater ? `被 ${eater.name} 吃掉了，1.5 秒後重生` : "你被吃掉了");
        respawnAt = performance.now() + 1500;
      }
    }
  }

  function maybeEatPlayers() {
    const alive = players.filter((p) => p.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const ra = radius(a.mass), rb = radius(b.mass);
        const d = dist(a, b);
        if (d > ra + rb) continue;
        let big = a, small = b;
        if (b.mass > a.mass) { big = b; small = a; }
        if (big.mass < small.mass * EAT_RATIO) {
          const nx = (b.x - a.x) / (d || 1);
          const ny = (b.y - a.y) / (d || 1);
          const push = (ra + rb - d) * 0.5;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          continue;
        }
        if (d + radius(small.mass) * 0.35 < radius(big.mass)) kill(small, big);
      }
    }
  }

  function eatFood(p) {
    const r = radius(p.mass);
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      const dx = f.x - p.x, dy = f.y - p.y;
      if (dx * dx + dy * dy < (r - 2) * (r - 2)) {
        p.mass += f.value;
        food.splice(i, 1);
        foodDirty = true;
        if (food.length < FOOD_N) addFood();
      }
    }
  }

  function thinkBot(p, dt) {
    p.seekT -= dt;
    let target = null, flee = null;
    let tDist = 1e9, fDist = 1e9;
    for (const o of players) {
      if (o === p || !o.alive) continue;
      const d = dist(p, o);
      if (o.mass > p.mass * EAT_RATIO && d < 280 && d < fDist) {
        flee = o; fDist = d;
      } else if (p.mass > o.mass * EAT_RATIO && d < 340 && d < tDist) {
        target = o; tDist = d;
      }
    }
    if (flee) {
      p.angle = Math.atan2(p.y - flee.y, p.x - flee.x);
      p.boost = fDist < 140 && p.mass > 22;
      return;
    }
    if (target) {
      p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      p.boost = tDist < 160 && p.mass > 26;
      return;
    }
    if (p.seekT <= 0) {
      let best = null, bd = 1e9;
      for (const f of food) {
        const d = dist(p, f);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) p.seek = Math.atan2(best.y - p.y, best.x - p.x);
      else p.seek = rand(0, Math.PI * 2);
      p.seekT = rand(0.4, 1.2);
    }
    p.angle = p.seek;
    p.boost = false;
  }

  function movePlayer(p, dt) {
    if (!p.alive) return;
    if (p.bot && (netMode !== "client")) thinkBot(p, dt);
    const sp = speedOf(p);
    p.x += Math.cos(p.angle) * sp * dt;
    p.y += Math.sin(p.angle) * sp * dt;
    const r = radius(p.mass);
    p.x = clamp(p.x, r, WORLD - r);
    p.y = clamp(p.y, r, WORLD - r);
    if (p.boost) {
      p.mass -= BOOST_COST * dt;
      if (p.mass < 12) { p.mass = 12; p.boost = false; }
      if (Math.random() < dt * 6 && food.length < FOOD_N + 50) {
        addFood(
          p.x - Math.cos(p.angle) * (r + 6),
          p.y - Math.sin(p.angle) * (r + 6),
          0.9,
          p.color
        );
      }
    }
    p.trail.push({ x: p.x, y: p.y });
    const maxTrail = 8 + (r / 6) | 0;
    if (p.trail.length > maxTrail) p.trail.splice(0, p.trail.length - maxTrail);
  }

  function simulate(dt) {
    if (netMode === "client") {
      if (me && me.alive) {
        me.angle = input.angle;
        me.boost = input.boost;
        movePlayer(me, dt);
      }
      return;
    }
    if (me && me.alive) {
      me.angle = input.angle;
      me.boost = input.boost && me.mass > 14;
    }
    for (const p of players) movePlayer(p, dt);
    for (const p of players) if (p.alive) eatFood(p);
    maybeEatPlayers();
    if (me && me.alive) bestMass = Math.max(bestMass, me.mass);
    if (me && !me.alive && netMode !== "solo" && respawnAt && performance.now() >= respawnAt) {
      respawnAt = 0;
      const pos = emptySpot(50);
      me.x = pos.x; me.y = pos.y;
      me.mass = START_MASS;
      me.alive = true;
      me.trail = [];
      toast("重生了，小心點");
    }
  }

  function worldToScreen(x, y) {
    return {
      x: (x - cam.x) * cam.z + W / 2,
      y: (y - cam.y) * cam.z + H / 2,
    };
  }

  function drawGrid() {
    const step = 80 * cam.z;
    const origin = worldToScreen(0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = origin.x % step;
    const y0 = origin.y % step;
    for (let x = x0; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = y0; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function drawCell(p) {
    if (!p.alive && p !== me) return;
    const r = radius(p.mass) * cam.z;
    const s = worldToScreen(p.x, p.y);
    if (s.x < -r - 40 || s.y < -r - 40 || s.x > W + r + 40 || s.y > H + r + 40) return;

    ctx.globalAlpha = p.alive ? 1 : 0.35;
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const ts = worldToScreen(t.x, t.y);
      const tr = r * (0.35 + 0.5 * i / p.trail.length);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = (p.alive ? 0.18 : 0.08) + 0.35 * i / (p.trail.length || 1);
      ctx.beginPath();
      ctx.arc(ts.x, ts.y, tr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = p.alive ? 1 : 0.35;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(s.x - r * 0.28, s.y - r * 0.28, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    const ex = Math.cos(p.angle), ey = Math.sin(p.angle);
    const eye = r * 0.22;
    const ox = ex * r * 0.28, oy = ey * r * 0.28;
    ctx.fillStyle = "#082016";
    ctx.beginPath();
    ctx.arc(s.x + ox - ey * eye * 0.9, s.y + oy + ex * eye * 0.9, eye, 0, Math.PI * 2);
    ctx.arc(s.x + ox + ey * eye * 0.9, s.y + oy - ex * eye * 0.9, eye, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s.x + ox - ey * eye * 0.9 + ex * 2, s.y + oy + ex * eye * 0.9 + ey * 2, eye * 0.32, 0, Math.PI * 2);
    ctx.arc(s.x + ox + ey * eye * 0.9 + ex * 2, s.y + oy - ex * eye * 0.9 + ey * 2, eye * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `700 ${Math.max(11, Math.min(16, r * 0.42))}px Segoe UI, Microsoft JhengHei, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(p.name, s.x, s.y + r + 14);
    ctx.fillStyle = "#fff";
    ctx.fillText(p.name, s.x, s.y + r + 13);
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    const mw = 92, mh = 92;
    const x = W - mw - 12, y = H - mh - 118;
    ctx.fillStyle = "rgba(8,12,22,0.7)";
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, mw, mh, 10);
    ctx.fill();
    ctx.stroke();
    for (const p of players) {
      if (!p.alive) continue;
      ctx.fillStyle = p === me ? "#fff" : p.color;
      ctx.beginPath();
      ctx.arc(x + (p.x / WORLD) * mw, y + (p.y / WORLD) * mh, p === me ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, W, H);
    if (mode !== "play" && mode !== "dead") {
      drawMenuBg();
      return;
    }
    if (me) {
      const wantZ = clamp(1.18 * (30 / radius(me.mass)), 0.38, 1.22);
      cam.z += (wantZ - cam.z) * 0.06;
      cam.x += (me.x - cam.x) * 0.12;
      cam.y += (me.y - cam.y) * 0.12;
    }
    drawGrid();

    const viewR = Math.hypot(W, H) / cam.z;
    for (const f of food) {
      if (Math.abs(f.x - cam.x) > viewR || Math.abs(f.y - cam.y) > viewR) continue;
      const s = worldToScreen(f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, f.r * cam.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const order = players.slice().sort((a, b) => a.mass - b.mass);
    for (const p of order) drawCell(p);
    drawMinimap();
  }

  function drawMenuBg() {
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, W, H);
    const t = performance.now() / 1000;
    for (let i = 0; i < 18; i++) {
      const x = (Math.sin(t * 0.3 + i) * 0.5 + 0.5) * W;
      const y = (Math.cos(t * 0.21 + i * 1.7) * 0.5 + 0.5) * H;
      ctx.fillStyle = i % 2 ? "rgba(61,255,154,0.08)" : "rgba(109,124,255,0.08)";
      ctx.beginPath();
      ctx.arc(x, y, 18 + (i % 5) * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updateHud() {
    if (!me) return;
    ui.score.textContent = String(Math.floor(me.mass) + kills * 8);
    ui.mass.textContent = String(Math.floor(me.mass));
    const ranked = players.filter((p) => p.alive).sort((a, b) => b.mass - a.mass).slice(0, 5);
    ui.board.innerHTML = ranked.map((p, i) => {
      const cls = p === me ? "me" : "";
      return `<div class="${cls}"><span>${i + 1}. ${esc(p.name)}</span><span>${Math.floor(p.mass)}</span></div>`;
    }).join("");
  }

  function showPlay() {
    mode = "play";
    ui.menu.classList.add("hidden");
    ui.join.classList.add("hidden");
    ui.dead.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    ui.boost.classList.remove("hidden");
    ui.stick.classList.remove("hidden");
    if (netMode !== "solo") ui.roomBar.classList.remove("hidden");
    else ui.roomBar.classList.add("hidden");
  }
  function showMenu() {
    mode = "menu";
    ui.menu.classList.remove("hidden");
    ui.join.classList.add("hidden");
    ui.dead.classList.add("hidden");
    ui.hud.classList.add("hidden");
    ui.boost.classList.add("hidden");
    ui.stick.classList.add("hidden");
    ui.roomBar.classList.add("hidden");
    closeNet();
  }
  function showDead(title, score, hint) {
    mode = "dead";
    ui.deadTitle.textContent = title;
    ui.deadScore.textContent = String(score);
    ui.deadHint.textContent = hint;
    ui.dead.classList.remove("hidden");
    ui.boost.classList.add("hidden");
    ui.stick.classList.add("hidden");
  }

  function loop(ts) {
    const dt = clamp((ts - last) / 1000, 0, 0.05);
    last = ts;
    if (mode === "play") {
      simulate(dt);
      netAcc += dt;
      if (netAcc >= 0.08) {
        netAcc = 0;
        if (netMode === "host") broadcastState();
        if (netMode === "client") sendInput();
      }
      updateHud();
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((t) => { last = t; loop(t); });

  // ---- input ----
  const pointers = new Map();
  function setStick(dx, dy) {
    const max = 36;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / max);
    const nx = (dx / len) * k * max;
    const ny = (dy / len) * k * max;
    ui.knob.style.left = 36 + nx + "px";
    ui.knob.style.top = 36 + ny + "px";
    if (k > 0.12) input.angle = Math.atan2(dy, dx);
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "play") return;
    if (e.target === ui.boost) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (mode !== "play") return;
    if (e.pointerType === "mouse" && pointers.size === 0) {
      input.angle = Math.atan2(e.clientY - H / 2, e.clientX - W / 2);
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    setStick(e.clientX - p.x, e.clientY - p.y);
  });
  function endPtr(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      ui.knob.style.left = "36px";
      ui.knob.style.top = "36px";
    }
  }
  canvas.addEventListener("pointerup", endPtr);
  canvas.addEventListener("pointercancel", endPtr);

  function boostOn() { input.boost = true; ui.boost.classList.add("down"); }
  function boostOff() { input.boost = false; ui.boost.classList.remove("down"); }
  ui.boost.addEventListener("pointerdown", (e) => { e.preventDefault(); boostOn(); });
  ui.boost.addEventListener("pointerup", boostOff);
  ui.boost.addEventListener("pointerleave", boostOff);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); boostOn(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") boostOff();
  });
  document.addEventListener("touchmove", (e) => {
    if (mode === "play") e.preventDefault();
  }, { passive: false });

  // ---- net ----
  function closeNet() {
    try { for (const c of conns.values()) c.close(); } catch (_) {}
    conns.clear();
    try { if (peer) peer.destroy(); } catch (_) {}
    peer = null;
    roomCode = "";
    netMode = "solo";
  }

  function packState() {
    const msg = {
      t: "st",
      p: players.map((p) => [p.id, p.x, p.y, p.angle, p.mass, p.boost ? 1 : 0, p.alive ? 1 : 0, p.name, p.color, p.human ? 1 : 0]),
    };
    if (foodDirty) {
      msg.f = food.map((f) => [f.id, f.x, f.y, f.color, f.r, f.value]);
      foodDirty = false;
    }
    return msg;
  }

  function applyState(msg) {
    const seen = new Set();
    for (const row of msg.p) {
      const [id, x, y, angle, mass, boost, alive, name, color, human] = row;
      seen.add(id);
      let p = players.find((q) => q.id === id);
      if (!p) {
        p = { id, name, color, x, y, angle, mass, boost: !!boost, alive: !!alive, bot: !human, human: !!human, trail: [], seek: 0, seekT: 0 };
        players.push(p);
      } else if (p !== me || !me.alive) {
        p.x = x; p.y = y;
      } else {
        p.x += (x - p.x) * 0.35;
        p.y += (y - p.y) * 0.35;
      }
      p.angle = angle;
      p.mass = mass;
      p.boost = !!boost;
      p.alive = !!alive;
      p.name = name;
      p.color = color;
      if (me && id === me.id) me = p;
    }
    for (let i = players.length - 1; i >= 0; i--) {
      if (!seen.has(players[i].id)) players.splice(i, 1);
    }
    if (msg.f) {
      food.length = 0;
      for (const row of msg.f) {
        food.push({ id: row[0], x: row[1], y: row[2], color: row[3], r: row[4], value: row[5] });
      }
    }
  }

  function broadcastState() {
    if (!conns.size) return;
    const msg = packState();
    const raw = JSON.stringify(msg);
    for (const c of conns.values()) {
      if (c.open) c.send(raw);
    }
  }

  function sendInput() {
    const c = [...conns.values()][0];
    if (!c || !c.open || !me) return;
    c.send(JSON.stringify({ t: "in", id: me.id, a: input.angle, b: input.boost ? 1 : 0 }));
  }

  function onPeerData(conn, data) {
    let msg = data;
    if (typeof data === "string") {
      try { msg = JSON.parse(data); } catch { return; }
    }
    if (!msg || !msg.t) return;
    if (netMode === "host" && msg.t === "in") {
      const p = players.find((q) => q.id === msg.id && q.human);
      if (p && p.alive) {
        p.angle = msg.a;
        p.boost = !!msg.b && p.mass > 14;
      }
    }
    if (netMode === "client" && msg.t === "st") applyState(msg);
    if (msg.t === "hello" && netMode === "host") {
      const humans = players.filter((p) => p.human).length;
      if (humans >= MAX_HUMANS) {
        conn.send(JSON.stringify({ t: "full" }));
        return;
      }
      const p = spawnPlayer({ name: String(msg.name || "玩家").slice(0, 8), human: true });
      conn.pid = p.id;
      foodDirty = true;
      const st = packState();
      conn.send(JSON.stringify({ t: "you", id: p.id, p: st.p, f: st.f }));
      toast(`${p.name} 加入了`);
    }
    if (msg.t === "you" && netMode === "client") {
      applyState(msg);
      me = players.find((p) => p.id === msg.id) || me;
      showPlay();
      toast("已進入房間");
    }
    if (msg.t === "full") toast("房間滿了");
  }

  function wireConn(conn) {
    conn.on("data", (d) => onPeerData(conn, d));
    conn.on("close", () => {
      conns.delete(conn.peer);
      if (netMode === "host" && conn.pid) {
        const p = players.find((q) => q.id === conn.pid);
        if (p) kill(p, null);
        toast("有人離開了");
      }
      if (netMode === "client") {
        toast("房主已離開");
        showMenu();
      }
    });
    conn.on("error", () => toast("連線出了一點問題"));
  }

  function startHost() {
    if (typeof Peer === "undefined") {
      toast("多人連線載入失敗，先玩單人");
      startSolo();
      return;
    }
    closeNet();
    roomCode = makeCode();
    netMode = "host";
    resetWorld(BOTS_MULTI);
    ui.roomCode.textContent = "房間 " + roomCode;
    showPlay();
    peer = new Peer("eatgame" + roomCode, { debug: 0 });
    peer.on("open", () => toast("房間已開，把代碼傳給朋友"));
    peer.on("error", (err) => {
      if (String(err).includes("taken") || err.type === "unavailable-id") {
        startHost();
        return;
      }
      toast("開房間失敗，改為單人");
      netMode = "solo";
      ui.roomBar.classList.add("hidden");
    });
    peer.on("connection", (conn) => {
      conns.set(conn.peer, conn);
      conn.on("open", () => wireConn(conn));
    });
  }

  function startJoin(code) {
    if (typeof Peer === "undefined") {
      toast("多人連線載入失敗");
      return;
    }
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length !== 4) { toast("請輸入 4 碼房間號"); return; }
    closeNet();
    netMode = "client";
    roomCode = code;
    resetWorld(0);
    players.length = 0;
    food.length = 0;
    me = { id: -1, name: playerName(), color: COLORS[0], x: WORLD / 2, y: WORLD / 2, angle: 0, mass: START_MASS, boost: false, alive: true, bot: false, human: true, trail: [] };
    players.push(me);
    ui.roomCode.textContent = "房間 " + roomCode;
    toast("連線中…");
    peer = new Peer({ debug: 0 });
    peer.on("open", () => {
      const conn = peer.connect("eatgame" + code, { reliable: true });
      conns.set(code, conn);
      conn.on("open", () => {
        wireConn(conn);
        conn.send(JSON.stringify({ t: "hello", name: me.name }));
      });
      conn.on("error", () => toast("找不到這個房間"));
    });
    peer.on("error", () => toast("連線失敗，確認房間號或請朋友重開"));
    setTimeout(() => {
      if (mode !== "play" && netMode === "client") toast("還在連…請確認雙方都開著遊戲");
    }, 4000);
  }

  function startSolo() {
    closeNet();
    netMode = "solo";
    resetWorld(BOTS_SOLO);
    showPlay();
  }

  $("btnSolo").onclick = startSolo;
  $("btnHost").onclick = startHost;
  $("btnJoin").onclick = () => {
    ui.menu.classList.add("hidden");
    ui.join.classList.remove("hidden");
    ui.joinCode.value = "";
    ui.joinCode.focus();
  };
  $("btnJoinBack").onclick = () => {
    ui.join.classList.add("hidden");
    ui.menu.classList.remove("hidden");
  };
  $("btnJoinGo").onclick = () => startJoin(ui.joinCode.value);
  $("btnAgain").onclick = () => {
    if (netMode === "host") {
      ui.dead.classList.add("hidden");
      const pos = emptySpot(50);
      me.x = pos.x; me.y = pos.y; me.mass = START_MASS; me.alive = true; me.trail = [];
      bestMass = START_MASS; kills = 0;
      showPlay();
    } else startSolo();
  };
  $("btnHome").onclick = showMenu;
  $("copyRoom").onclick = async () => {
    const url = location.origin + location.pathname + "?room=" + roomCode;
    const text = `來玩大吃小！房間 ${roomCode}\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("邀請已複製，傳給朋友吧");
    } catch {
      toast("房間號是 " + roomCode);
    }
  };

  const saved = localStorage.getItem("eat-name");
  if (saved) ui.name.value = saved;
  ui.name.addEventListener("change", () => localStorage.setItem("eat-name", ui.name.value.slice(0, 8)));

  const q = new URLSearchParams(location.search).get("room");
  if (q) {
    ui.joinCode.value = q.toUpperCase();
    ui.menu.classList.add("hidden");
    ui.join.classList.remove("hidden");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
