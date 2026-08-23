(() => {
  const WORLD = 5800;
  const FOOD_N = 560;
  const BOTS_SOLO = 12;
  const BOTS_MULTI = 8;
  const MAX_HUMANS = 8;
  const MAX_LIVES = 3;
  const START_MASS = 10;
  const PI2 = Math.PI * 2;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const COLORS = [
    "#3dff9a", "#5b8cff", "#ff4f8b", "#ffd166", "#4cc9f0",
    "#9b5de5", "#00f5d4", "#f15bb5", "#fee440", "#00bbf9",
    "#80ed99", "#ff9f1c",
  ];
  const BOT_NAMES = [
    "小魚", "豆豆", "閃電", "糯米", "泡泡", "鯊魚", "芒果", "幽靈",
    "企鵝", "布丁", "芝麻", "火箭", "雪球", "西瓜", "辣椒", "奶茶",
    "夜貓", "旋風", "糖糖", "黑鯊", "小白", "阿呆", "飛魚", "玉米",
    "章魚", "栗子", "跳跳", "豆芽", "蝸牛", "火龍", "毛毛", "汽水",
  ];

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });
  const $ = (id) => document.getElementById(id);
  const ui = {
    menu: $("menu"), join: $("join"), dead: $("dead"), hud: $("hud"),
    boost: $("boost"), boostBar: $("boostBar"), exitBtn: $("exitBtn"),
    board: $("board"), rank: $("rank"), score: $("score"), lives: $("lives"),
    kills: $("kills"), roomBar: $("roomBar"), roomCode: $("roomCode"),
    name: $("name"), joinCode: $("joinCode"), toast: $("toast"),
    deadTitle: $("deadTitle"), deadScore: $("deadScore"), deadHint: $("deadHint"),
    feed: $("feed"), tip: $("tip"),
  };

  let W = 0, H = 0, dpr = 1, t = 0;
  let mode = "menu";
  let netMode = "solo";
  let last = 0;
  let foodId = 1, snakeId = 1;
  const food = [];
  const snakes = [];
  const bits = [];
  const feed = [];
  let me = null;
  let cam = { x: WORLD / 2, y: WORLD / 2, z: 1, sx: 0, sy: 0 };
  let input = { angle: 0, boost: false, ax: 0, ay: -1 };
  let best = START_MASS, kills = 0, diedTo = "";
  let roomCode = "";
  let peer = null;
  const conns = new Map();
  let foodDirty = true, netAcc = 0, physAcc = 0, toastTimer = 0, tipUntil = 0, matchOver = false;
  let ac = null;
  const foodGrid = new Map();
  const bodyGrid = new Map();
  const CELL = 90;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm(a) { while (a > Math.PI) a -= PI2; while (a < -Math.PI) a += PI2; return a; }
  function key(x, y) { return ((x / CELL) | 0) + ":" + ((y / CELL) | 0); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function radius(mass) { return 6.6 + Math.pow(Math.max(1, mass), 0.42) * 1.32; }
  function bodyRadius(mass) { return radius(mass); }
  function headRadius(mass) { return radius(mass); }
  function spacing(mass) { return radius(mass) * 0.36; }
  function segs(mass) { return Math.max(28, Math.min(240, (18 + mass * 1.2) | 0)); }
  function speedOf(s) {
    const slow = 1 - Math.min(0.22, s.mass / 1100);
    return (148 + 28 / (1 + radius(s.mass) * 0.04)) * slow * (s.boost ? 1.7 : 1);
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
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1700);
  }
  function addFeed(text) {
    feed.unshift({ text, t: 2.8 });
    if (feed.length > 5) feed.pop();
  }

  function unlockAudio() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  function beep(freq, dur, type, vol) {
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.value = vol || 0.05;
    o.connect(g); g.connect(ac.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.stop(ac.currentTime + dur + 0.02);
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

  function emptySpot() {
    for (let i = 0; i < 40; i++) {
      const x = rand(220, WORLD - 220), y = rand(220, WORLD - 220);
      let ok = true;
      for (const s of snakes) {
        if (!s.alive || !s.pts[0]) continue;
        if (Math.hypot(s.pts[0].x - x, s.pts[0].y - y) < 160) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: rand(300, WORLD - 300), y: rand(300, WORLD - 300) };
  }

  function addFood(x, y, value, color, special, kill) {
    const isKill = !!kill;
    food.push({
      id: foodId++,
      x: x ?? rand(40, WORLD - 40),
      y: y ?? rand(40, WORLD - 40),
      value: value ?? (isKill ? rand(2.6, 4.2) : special ? rand(1.6, 2.4) : rand(1, 2.2)),
      color: color || (isKill ? "#ffd166" : pick(COLORS)),
      r: isKill ? rand(4.8, 6.2) : special ? rand(3.6, 4.8) : rand(2.8, 4.2),
      special: !!special,
      kill: isKill,
    });
    foodDirty = true;
  }

  function burst(x, y, color, n, force) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, PI2), sp = rand(40, force || 220);
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), color, r: rand(2, 5) });
    }
    if (bits.length > 260) bits.splice(0, bits.length - 260);
  }

  function makeSnake(opts) {
    const pos = opts.pos || emptySpot();
    const ang = rand(0, PI2);
    const mass = opts.mass || START_MASS;
    const pts = [];
    const spc = spacing(mass);
    for (let i = 0; i < segs(mass); i++) {
      pts.push({ x: pos.x - Math.cos(ang) * spc * i, y: pos.y - Math.sin(ang) * spc * i });
    }
    const s = {
      id: opts.id || snakeId++,
      name: opts.name || pick(BOT_NAMES),
      color: opts.color || pick(COLORS),
      angle: ang,
      targetAngle: ang,
      mass,
      boost: false,
      stamina: 1,
      alive: true,
      bot: !!opts.bot,
      human: !!opts.human,
      pts,
      protect: performance.now() + (opts.protect || 1800),
      mood: "eat",
      moodT: 0,
      kills: 0,
      deaths: 0,
      out: false,
      score: 0,
      respawnAt: 0,
    };
    snakes.push(s);
    return s;
  }

  function resetWorld(botCount) {
    food.length = 0; snakes.length = 0; bits.length = 0; feed.length = 0;
    foodId = 1; snakeId = 1; foodDirty = true;
    best = START_MASS; kills = 0; diedTo = ""; matchOver = false;
    for (let i = 0; i < FOOD_N; i++) addFood();
    for (let i = 0; i < 18; i++) {
      const cx = rand(400, WORLD - 400), cy = rand(400, WORLD - 400);
      for (let k = 0; k < 14; k++) addFood(cx + rand(-90, 90), cy + rand(-90, 90), rand(1, 2.2), pick(COLORS), false, false);
    }
    for (let i = 0; i < 8; i++) addFood(undefined, undefined, rand(1.6, 2.4), undefined, true, false);
    me = makeSnake({ name: playerName(), human: true, color: COLORS[0], protect: 2200 });
    for (let i = 0; i < botCount; i++) makeSnake({ bot: true, mass: rand(8, 16) });
    cam.x = me.pts[0].x; cam.y = me.pts[0].y; cam.z = 1;
    input.angle = me.angle;
    tipUntil = performance.now() + 3200;
    ui.tip.classList.add("show");
  }

  function dropBody(s) {
    const pieces = clamp((s.pts.length / 3) | 0, 14, 28);
    const each = Math.max(2.4, (s.mass * 0.8) / pieces);
    const step = Math.max(1, (s.pts.length / pieces) | 0);
    for (let i = 0; i < s.pts.length; i += step) {
      const p = s.pts[i];
      addFood(p.x + rand(-14, 14), p.y + rand(-14, 14), rand(each * 0.85, each * 1.15), s.color, false, true);
      if (i % 3 === 0) burst(p.x, p.y, "#ffd166", 6, 170);
    }
  }

  function kickIfNeeded(s) {
    if (netMode !== "host" || !s.human || s === me) return;
    for (const [k, c] of conns) {
      if (c.pid === s.id) {
        try { c.send(JSON.stringify({ t: "kicked" })); c.close(); } catch (_) {}
        conns.delete(k);
      }
    }
  }

  function remainingPlayers() {
    return snakes.filter((s) => !s.out);
  }

  function checkEnd() {
    if (matchOver || mode !== "play") return;
    const left = remainingPlayers();
    if (left.length > 1) return;
    matchOver = true;
    const w = left[0];
    const myScore = me ? Math.floor(me.score) : 0;
    if (!w) showDead("沒人獲勝", myScore, "再來一局");
    else if (w === me) showDead("你贏了", myScore, "最後留下的就是贏家");
    else showDead(w.name + " 獲勝", myScore, "最後留下的就是贏家");
    if (netMode === "host") {
      const raw = JSON.stringify({ t: "over", name: w ? w.name : "", win: w === me ? 0 : 1 });
      for (const c of conns.values()) if (c.open) try { c.send(raw); } catch (_) {}
    }
  }

  function respawnSnake(s) {
    const pos = emptySpot();
    const ang = rand(0, PI2);
    const mass = START_MASS;
    s.mass = mass;
    s.alive = true;
    s.boost = false;
    s.stamina = 1;
    s.out = false;
    s.respawnAt = 0;
    s.angle = ang;
    s.targetAngle = ang;
    s.protect = performance.now() + 2200;
    s.pts = [];
    const spc = spacing(mass);
    for (let i = 0; i < segs(mass); i++) {
      s.pts.push({ x: pos.x - Math.cos(ang) * spc * i, y: pos.y - Math.sin(ang) * spc * i });
    }
    if (s === me) {
      cam.x = pos.x; cam.y = pos.y;
      input.angle = ang;
    }
  }

  function kill(victim, eater) {
    if (!victim.alive || victim.out) return;
    if (performance.now() < victim.protect) return;
    if (eater && performance.now() < eater.protect) return;
    victim.alive = false;
    victim.boost = false;
    victim.deaths = (victim.deaths || 0) + 1;
    burst(victim.pts[0].x, victim.pts[0].y, victim.color, 36, 320);
    dropBody(victim);
    if (eater && eater.alive) {
      eater.kills += 1;
      eater.score = (eater.score || 0) + 80;
      addFeed(victim.name + " 撞上了 " + eater.name);
      if (eater === me) {
        kills += 1;
        cam.sx = 10;
        beep(220, 0.09, "sawtooth", 0.06);
        beep(440, 0.12, "square", 0.04);
      }
    } else addFeed(victim.name + " 撞上去了");
    const leftLives = MAX_LIVES - victim.deaths;
    if (victim.deaths >= MAX_LIVES) {
      victim.out = true;
      addFeed(victim.name + " 出局了");
      if (victim === me) {
        beep(160, 0.3, "triangle", 0.07);
        toast("死了 3 次，出局");
      } else kickIfNeeded(victim);
    } else {
      victim.respawnAt = performance.now() + 1400;
      if (victim === me) toast("還剩 " + leftLives + " 條命");
    }
    if (victim === me) {
      best = Math.max(best, me.mass);
      diedTo = eater ? eater.name : "";
    }
    checkEnd();
    if (victim === me && victim.out && !matchOver && netMode === "solo") {
      matchOver = true;
      showDead("你出局了", Math.floor(me.score || 0), "死了 3 次");
    }
  }

  function rebuildFoodGrid() {
    foodGrid.clear();
    for (const f of food) {
      const k = key(f.x, f.y);
      let arr = foodGrid.get(k);
      if (!arr) { arr = []; foodGrid.set(k, arr); }
      arr.push(f);
    }
  }
  function rebuildBodyGrid() {
    bodyGrid.clear();
    for (const s of snakes) {
      if (!s.alive) continue;
      for (let i = 0; i < s.pts.length; i += 2) {
        const p = s.pts[i];
        const k = key(p.x, p.y);
        let arr = bodyGrid.get(k);
        if (!arr) { arr = []; bodyGrid.set(k, arr); }
        arr.push({ s, i, x: p.x, y: p.y });
      }
    }
  }
  function nearby(map, x, y, fn) {
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const arr = map.get((cx + ox) + ":" + (cy + oy));
        if (!arr) continue;
        for (const item of arr) fn(item);
      }
    }
  }

  function thinkBot(s, dt) {
    s.moodT -= dt;
    const head = s.pts[0];
    let flee = null, hunt = null, fd = 1e9, hd = 1e9;
    for (const o of snakes) {
      if (o === s || !o.alive || o.out) continue;
      const d = Math.hypot(o.pts[0].x - head.x, o.pts[0].y - head.y);
      const danger = 130 + bodyRadius(o.mass) * 4 + o.pts.length * 0.35;
      if (d < danger && d < fd) {
        flee = o; fd = d;
      } else if (d < 460 && d < hd) {
        hunt = o; hd = d;
      }
    }
    if (flee) {
      s.mood = "flee";
      s.targetAngle = Math.atan2(head.y - flee.pts[0].y, head.x - flee.pts[0].x) + rand(-0.2, 0.2);
      s.boost = fd < 170 && s.stamina > 0.2;
      return;
    }
    if (hunt && (s.moodT <= 0 || s.mood === "hunt")) {
      s.mood = "hunt";
      s.moodT = rand(0.6, 1.4);
      const h = hunt.pts[0];
      const cut = hunt.pts[Math.min(8, hunt.pts.length - 1)];
      const aim = Math.random() < 0.55 ? cut : h;
      s.targetAngle = Math.atan2(aim.y - head.y, aim.x - head.x);
      s.boost = hd < 150 && s.stamina > 0.25;
      return;
    }
    if (s.moodT <= 0) {
      s.mood = "eat";
      s.moodT = rand(0.35, 0.9);
      let bestF = null, bd = 1e9;
      nearby(foodGrid, head.x, head.y, (f) => {
        const d = Math.hypot(f.x - head.x, f.y - head.y);
        if (d < bd) { bd = d; bestF = f; }
      });
      if (!bestF) {
        for (const f of food) {
          const d = Math.hypot(f.x - head.x, f.y - head.y);
          if (d < bd) { bd = d; bestF = f; }
          if (bd < 200) break;
        }
      }
      if (bestF) s.targetAngle = Math.atan2(bestF.y - head.y, bestF.x - head.x);
      else s.targetAngle = s.angle + rand(-0.8, 0.8);
      s.boost = false;
    }
    if (head.x < 180 || head.y < 180 || head.x > WORLD - 180 || head.y > WORLD - 180) {
      s.targetAngle = Math.atan2(WORLD / 2 - head.y, WORLD / 2 - head.x);
      s.boost = false;
    }
  }

  function stepSnake(s, dt) {
    if (!s.alive) return;
    if (s.bot && netMode !== "client") thinkBot(s, dt);
    const turn = (s.boost ? 5.5 : 4.6);
    const diff = norm(s.targetAngle - s.angle);
    s.angle += clamp(diff, -turn * dt, turn * dt);
    const sp = speedOf(s);
    const r = radius(s.mass);
    let nx = s.pts[0].x + Math.cos(s.angle) * sp * dt;
    let ny = s.pts[0].y + Math.sin(s.angle) * sp * dt;
    if (nx < r) { nx = r; s.angle = Math.PI - s.angle; s.targetAngle = s.angle; }
    if (nx > WORLD - r) { nx = WORLD - r; s.angle = Math.PI - s.angle; s.targetAngle = s.angle; }
    if (ny < r) { ny = r; s.angle = -s.angle; s.targetAngle = s.angle; }
    if (ny > WORLD - r) { ny = WORLD - r; s.angle = -s.angle; s.targetAngle = s.angle; }
    s.pts[0].x = nx;
    s.pts[0].y = ny;
    const spc = spacing(s.mass);
    for (let i = 1; i < s.pts.length; i++) {
      const px = s.pts[i - 1].x, py = s.pts[i - 1].y;
      let dx = s.pts[i].x - px, dy = s.pts[i].y - py;
      const d = Math.hypot(dx, dy) || 0.0001;
      s.pts[i].x = px + dx / d * spc;
      s.pts[i].y = py + dy / d * spc;
    }
    const want = segs(s.mass);
    while (s.pts.length > want) s.pts.pop();
    while (s.pts.length < want) {
      const lastP = s.pts[s.pts.length - 1];
      const prev = s.pts[s.pts.length - 2] || lastP;
      let dx = lastP.x - prev.x, dy = lastP.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      s.pts.push({ x: lastP.x + dx / d * spc, y: lastP.y + dy / d * spc });
    }
    if (s.stamina == null) s.stamina = 1;
    if (s.boost && s.stamina > 0.02) {
      s.stamina = Math.max(0, s.stamina - dt * 0.38);
      if (s.stamina <= 0.02) s.boost = false;
    } else {
      s.stamina = Math.min(1, s.stamina + dt * 0.26);
    }
  }

  function eatAndFight() {
    rebuildFoodGrid();
    rebuildBodyGrid();
    for (const s of snakes) {
      if (!s.alive) continue;
      const head = s.pts[0];
      const r = radius(s.mass);
      const eaten = [];
      nearby(foodGrid, head.x, head.y, (f) => {
        const dx = f.x - head.x, dy = f.y - head.y;
        const d = Math.hypot(dx, dy);
        if (d < r + f.r + (f.kill ? 16 : 8)) {
          f.x -= dx * (f.kill ? 0.16 : 0.1); f.y -= dy * (f.kill ? 0.16 : 0.1);
        }
        if (d < r + f.r * 0.2 && !f._eaten) { f._eaten = true; eaten.push(f); }
      });
      if (eaten.length) {
        for (const f of eaten) {
          s.mass += f.value;
          s.score = (s.score || 0) + Math.round(f.value * 10);
          burst(f.x, f.y, f.color, f.kill ? 12 : 3, f.kill ? 140 : 70);
          const ix = food.indexOf(f);
          if (ix >= 0) food.splice(ix, 1);
        }
        foodDirty = true;
        if (s === me) beep(eaten.some((f) => f.kill) ? 520 : 700, 0.045, "sine", 0.035);
        let crumbs = food.filter((f) => !f.kill).length;
        while (crumbs < FOOD_N) { addFood(); crumbs++; }
      }
    }
    for (const s of snakes) {
      if (!s.alive) continue;
      const head = s.pts[0];
      const hr = radius(s.mass);
      nearby(bodyGrid, head.x, head.y, (item) => {
        if (!s.alive || item.s === s || !item.s.alive || item.s.out) return;
        const neck = Math.max(8, ((radius(item.s.mass) / spacing(item.s.mass)) | 0) + 5);
        if (item.i < neck) return;
        const hitR = hr * 0.7 + radius(item.s.mass) * 0.7;
        const d = Math.hypot(item.x - head.x, item.y - head.y);
        if (d < hitR) kill(s, item.s);
      });
    }
  }

  function simulate(dt) {
    t += dt;
    if (netMode !== "client") rebuildFoodGrid();
    if (netMode === "client") {
      if (me && me.alive && !me.out) {
        me.targetAngle = input.angle;
        me.boost = input.boost && me.stamina > 0.05;
        stepSnake(me, dt);
      }
    } else {
      if (me && me.alive && !me.out) {
        me.targetAngle = input.angle;
        me.boost = input.boost && me.stamina > 0.05;
      }
      for (const s of snakes) if (s.alive && !s.out) stepSnake(s, dt);
      eatAndFight();
      const now = performance.now();
      for (const s of snakes) {
        if (!s.alive && !s.out && s.respawnAt && now >= s.respawnAt) respawnSnake(s);
      }
      if (me && me.alive) best = Math.max(best, me.mass);
      checkEnd();
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.92; b.vy *= 0.92;
      if (b.life <= 0) bits.splice(i, 1);
    }
    for (let i = feed.length - 1; i >= 0; i--) {
      feed[i].t -= dt;
      if (feed[i].t <= 0) feed.splice(i, 1);
    }
    cam.sx *= 0.84; cam.sy *= 0.84;
    if (performance.now() > tipUntil) ui.tip.classList.remove("show");
  }

  function w2s(x, y) {
    return {
      x: (x - cam.x) * cam.z + W / 2 + cam.sx,
      y: (y - cam.y) * cam.z + H / 2 + cam.sy,
    };
  }

  function drawSnake(s) {
    if (!s.pts.length || s.out && !s.alive) return;
    if (!s.alive) return;
    const r = radius(s.mass) * cam.z;
    const head = w2s(s.pts[0].x, s.pts[0].y);
    if (head.x < -80 || head.y < -80 || head.x > W + 80 || head.y > H + 80) {
      let any = false;
      for (let i = 0; i < s.pts.length; i += 6) {
        const p = w2s(s.pts[i].x, s.pts[i].y);
        if (p.x > -40 && p.y > -40 && p.x < W + 40 && p.y < H + 40) { any = true; break; }
      }
      if (!any) return;
    }
    const flash = performance.now() < s.protect && ((performance.now() / 120) | 0) % 2 === 0;
    ctx.globalAlpha = flash ? 0.55 : 1;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    for (let i = s.pts.length - 1; i >= 0; i--) {
      const p = w2s(s.pts[i].x, s.pts[i].y);
      if (i === s.pts.length - 1) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, PI2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(head.x - r * 0.25, head.y - r * 0.28, r * 0.38, 0, PI2);
    ctx.fill();
    const ex = Math.cos(s.angle), ey = Math.sin(s.angle);
    const eye = Math.max(2.4, r * 0.22);
    const ox = ex * r * 0.32, oy = ey * r * 0.32;
    ctx.fillStyle = "#102018";
    ctx.beginPath();
    ctx.arc(head.x + ox - ey * eye * 0.95, head.y + oy + ex * eye * 0.95, eye, 0, PI2);
    ctx.arc(head.x + ox + ey * eye * 0.95, head.y + oy - ex * eye * 0.95, eye, 0, PI2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(head.x + ox - ey * eye * 0.95 + ex * 1.6, head.y + oy + ex * eye * 0.95 + ey * 1.6, eye * 0.35, 0, PI2);
    ctx.arc(head.x + ox + ey * eye * 0.95 + ex * 1.6, head.y + oy - ex * eye * 0.95 + ey * 1.6, eye * 0.35, 0, PI2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.font = "700 12px Segoe UI, Microsoft JhengHei, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(s.name, head.x, head.y + r + 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(s.name, head.x, head.y + r + 15);
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, W, H);
    if (mode !== "play" && mode !== "dead") {
      const tt = performance.now() / 1000;
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? "rgba(61,255,154,0.07)" : "rgba(91,108,255,0.07)";
        ctx.beginPath();
        ctx.arc((Math.sin(tt * 0.4 + i) * 0.5 + 0.5) * W, (Math.cos(tt * 0.28 + i * 1.3) * 0.5 + 0.5) * H, 16 + i * 3, 0, PI2);
        ctx.fill();
      }
      return;
    }
    if (me && me.pts[0]) {
      const wantZ = clamp(1.12 * (28 / radius(me.mass)), 0.38, 1.22);
      cam.z += (wantZ - cam.z) * 0.05;
      cam.x += (me.pts[0].x - cam.x) * 0.14;
      cam.y += (me.pts[0].y - cam.y) * 0.14;
    }
    const step = 70 * cam.z;
    const origin = w2s(0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = origin.x % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = origin.y % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const view = Math.hypot(W, H) / cam.z + 40;
    for (const f of food) {
      if (Math.abs(f.x - cam.x) > view || Math.abs(f.y - cam.y) > view) continue;
      const p = w2s(f.x, f.y);
      const pulse = 1 + Math.sin(t * 6 + f.id) * 0.12;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = f.color;
      if (f.kill) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.r * cam.z * pulse * 2.1, 0, PI2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, f.r * cam.z * pulse, 0, PI2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const b of bits) {
      const p = w2s(b.x, b.y);
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * cam.z, 0, PI2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const order = snakes.slice().sort((a, b) => a.mass - b.mass);
    for (const s of order) drawSnake(s);

    const mw = 102, mh = 102, mx = W - mw - 12, my = H - mh - 122;
    ctx.fillStyle = "rgba(6,10,22,0.75)";
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mx, my, mw, mh, 12); else ctx.rect(mx, my, mw, mh);
    ctx.fill(); ctx.stroke();
    for (const s of snakes) {
      if (!s.alive) continue;
      ctx.strokeStyle = s === me ? "#fff" : s.color;
      ctx.lineWidth = s === me ? 2 : 1;
      ctx.beginPath();
      const a = s.pts[0], b = s.pts[Math.min(10, s.pts.length - 1)];
      ctx.moveTo(mx + (a.x / WORLD) * mw, my + (a.y / WORLD) * mh);
      ctx.lineTo(mx + (b.x / WORLD) * mw, my + (b.y / WORLD) * mh);
      ctx.stroke();
    }
  }

  function updateHud() {
    if (!me) return;
    const ranked = snakes.filter((s) => !s.out).sort((a, b) => b.score - a.score);
    const rank = ranked.indexOf(me) + 1;
    ui.rank.textContent = rank > 0 ? String(rank) : "-";
    ui.score.textContent = String(Math.floor(me.score || 0));
    if (ui.lives) ui.lives.textContent = String(Math.max(0, MAX_LIVES - (me.deaths || 0)));
    ui.kills.textContent = String(kills);
    if (ui.boostBar) ui.boostBar.style.height = Math.round((me.stamina || 0) * 100) + "%";
    ui.board.innerHTML = ranked.slice(0, 6).map((s, i) =>
      `<div class="row ${s === me ? "me" : ""}"><span>${i + 1}. ${esc(s.name)}</span><span>${Math.floor(s.score || 0)}</span></div>`
    ).join("");
    ui.feed.innerHTML = feed.map((f) => `<div>${esc(f.text)}</div>`).join("");
  }

  function showPlay() {
    mode = "play";
    ui.menu.classList.add("hidden");
    ui.join.classList.add("hidden");
    ui.dead.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    ui.feed.classList.remove("hidden");
    ui.boost.classList.remove("hidden");
    ui.exitBtn.classList.remove("hidden");
    ui.roomBar.classList.toggle("hidden", netMode === "solo");
  }
  function showMenu() {
    mode = "menu";
    ui.menu.classList.remove("hidden");
    ui.join.classList.add("hidden");
    ui.dead.classList.add("hidden");
    ui.hud.classList.add("hidden");
    ui.feed.classList.add("hidden");
    ui.boost.classList.add("hidden");
    ui.exitBtn.classList.add("hidden");
    ui.roomBar.classList.add("hidden");
    ui.tip.classList.remove("show");
    closeNet();
  }
  function showDead(title, score, hint) {
    mode = "dead";
    ui.deadTitle.textContent = title;
    ui.deadScore.textContent = String(score);
    ui.deadHint.textContent = hint;
    ui.dead.classList.remove("hidden");
    ui.boost.classList.add("hidden");
    ui.exitBtn.classList.add("hidden");
  }

  function loop(ts) {
    const dt = clamp((ts - last) / 1000, 0, 0.05);
    last = ts;
    if (mode === "play") {
      physAcc += dt;
      const STEP = 1 / 60;
      let steps = 0;
      while (physAcc >= STEP && steps < 4) {
        simulate(STEP);
        physAcc -= STEP;
        steps += 1;
      }
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
  requestAnimationFrame((ts) => { last = ts; loop(ts); });

  function pointToAngle(x, y) {
    input.ax = x - W / 2;
    input.ay = y - H / 2;
    const len = Math.hypot(input.ax, input.ay);
    if (len < 28) return;
    const want = Math.atan2(input.ay, input.ax);
    const d = norm(want - input.angle);
    input.angle += clamp(d, -0.12, 0.12);
  }
  canvas.addEventListener("pointerdown", (e) => {
    unlockAudio();
    if (mode !== "play") return;
    if (e.target === ui.boost) return;
    pointToAngle(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (mode !== "play") return;
    pointToAngle(e.clientX, e.clientY);
  });
  function boostOn() { input.boost = true; ui.boost.classList.add("down"); }
  function boostOff() { input.boost = false; ui.boost.classList.remove("down"); }
  ui.boost.addEventListener("pointerdown", (e) => { e.preventDefault(); unlockAudio(); boostOn(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => ui.boost.addEventListener(ev, boostOff));
  window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); boostOn(); } });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") boostOff(); });
  document.addEventListener("touchmove", (e) => { if (mode === "play") e.preventDefault(); }, { passive: false });

  function closeNet() {
    try { for (const c of conns.values()) c.close(); } catch (_) {}
    conns.clear();
    try { if (peer) peer.destroy(); } catch (_) {}
    peer = null; roomCode = ""; netMode = "solo";
  }
  function packState() {
    const msg = {
      t: "st",
      p: snakes.filter((s) => !s.out && s.pts[0]).map((s) => [
        s.id, s.pts[0].x, s.pts[0].y, s.angle, s.mass,
        s.boost ? 1 : 0, s.alive ? 1 : 0, s.name, s.color, s.human ? 1 : 0,
        s.deaths || 0, Math.floor(s.score || 0),
      ]),
    };
    if (foodDirty) {
      msg.f = food.map((f) => [f.id, f.x, f.y, f.color, f.r, f.value, f.kill ? 1 : 0]);
      foodDirty = false;
    }
    return msg;
  }
  function applyState(msg) {
    const seen = new Set();
    for (const row of msg.p) {
      const [id, x, y, angle, mass, boost, alive, name, color, human, deaths, score] = row;
      seen.add(id);
      let s = snakes.find((q) => q.id === id);
      if (!s) {
        s = makeSnake({ id, name, color, human: !!human, bot: !human, pos: { x, y }, mass });
      } else if (!(me && id === me.id && me.alive)) {
        s.pts[0].x = x; s.pts[0].y = y;
        const spc = spacing(mass);
        for (let i = 1; i < s.pts.length; i++) {
          const px = s.pts[i - 1].x, py = s.pts[i - 1].y;
          let dx = s.pts[i].x - px, dy = s.pts[i].y - py;
          const d = Math.hypot(dx, dy) || 0.0001;
          s.pts[i].x = px + dx / d * spc;
          s.pts[i].y = py + dy / d * spc;
        }
      }
      s.angle = angle; s.mass = mass; s.boost = !!boost; s.alive = !!alive;
      s.name = name; s.color = color;
      s.deaths = deaths || 0; s.score = score || s.score || 0;
      if (me && id === me.id) me = s;
    }
    for (let i = snakes.length - 1; i >= 0; i--) if (!seen.has(snakes[i].id)) snakes.splice(i, 1);
    if (msg.f) {
      food.length = 0;
      for (const row of msg.f) food.push({ id: row[0], x: row[1], y: row[2], color: row[3], r: row[4], value: row[5], special: false, kill: !!row[6] });
    }
  }
  function broadcastState() {
    if (!conns.size) return;
    const raw = JSON.stringify(packState());
    for (const c of conns.values()) if (c.open) c.send(raw);
  }
  function sendInput() {
    const c = [...conns.values()][0];
    if (!c || !c.open || !me) return;
    c.send(JSON.stringify({ t: "in", id: me.id, a: input.angle, b: input.boost ? 1 : 0 }));
  }
  function onPeerData(conn, data) {
    let msg = data;
    if (typeof data === "string") { try { msg = JSON.parse(data); } catch { return; } }
    if (!msg || !msg.t) return;
    if (netMode === "host" && msg.t === "in") {
      const s = snakes.find((q) => q.id === msg.id && q.human);
      if (s && s.alive) { s.targetAngle = msg.a; s.boost = !!msg.b && s.stamina > 0.05; }
    }
    if (netMode === "client" && msg.t === "st") applyState(msg);
    if (msg.t === "hello" && netMode === "host") {
      if (snakes.filter((s) => s.human && !s.out).length >= MAX_HUMANS) {
        conn.send(JSON.stringify({ t: "full" })); return;
      }
      const s = makeSnake({ name: String(msg.name || "玩家").slice(0, 8), human: true, protect: 2500 });
      conn.pid = s.id; foodDirty = true;
      const st = packState();
      conn.send(JSON.stringify({ t: "you", id: s.id, p: st.p, f: st.f }));
      toast(s.name + " 加入了");
    }
    if (msg.t === "you" && netMode === "client") {
      applyState(msg);
      me = snakes.find((s) => s.id === msg.id) || me;
      showPlay();
      toast("已進入房間");
    }
    if (msg.t === "full") toast("房間滿了");
    if (msg.t === "kicked") {
      toast("死了 3 次，已退出房間");
      showMenu();
    }
    if (msg.t === "over") {
      matchOver = true;
      const myScore = me ? Math.floor(me.score) : 0;
      if (msg.name && msg.name === (me && me.name)) showDead("你贏了", myScore, "最後留下的就是贏家");
      else showDead((msg.name || "有人") + " 獲勝", myScore, "最後留下的就是贏家");
    }
    if (msg.t === "rst") {
      matchOver = false;
      snakes.length = 0; food.length = 0;
      if (msg.id && me) me.id = msg.id;
      showPlay();
      toast("新的一局開始");
    }
  }
  function wireConn(conn) {
    conn.on("data", (d) => onPeerData(conn, d));
    conn.on("close", () => {
      conns.delete(conn.peer);
      if (netMode === "host" && conn.pid) {
        const s = snakes.find((q) => q.id === conn.pid);
        if (s && !s.out) { s.alive = false; s.out = true; checkEnd(); }
        toast("有人離開了");
      }
      if (netMode === "client") { toast("房主已離開"); showMenu(); }
    });
  }
  function startHost() {
    if (typeof Peer === "undefined") { toast("多人連線載入失敗，改單人"); startSolo(); return; }
    closeNet();
    roomCode = makeCode();
    netMode = "host";
    resetWorld(BOTS_MULTI);
    ui.roomCode.textContent = "房間 " + roomCode;
    showPlay();
    peer = new Peer("eatgame" + roomCode, { debug: 0 });
    peer.on("open", () => toast("房間已開，把代碼傳給朋友"));
    peer.on("error", (err) => {
      if (err.type === "unavailable-id") { startHost(); return; }
      toast("開房間失敗，改單人"); netMode = "solo"; ui.roomBar.classList.add("hidden");
    });
    peer.on("connection", (conn) => {
      conns.set(conn.peer, conn);
      conn.on("open", () => wireConn(conn));
    });
  }
  function startJoin(code) {
    if (typeof Peer === "undefined") { toast("多人連線載入失敗"); return; }
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length !== 4) { toast("請輸入 4 碼房間號"); return; }
    closeNet();
    netMode = "client";
    roomCode = code;
    resetWorld(0);
    snakes.length = 0; food.length = 0;
    me = makeSnake({ name: playerName(), human: true });
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
    peer.on("error", () => toast("連線失敗，確認房間號"));
  }
  function startSolo() {
    closeNet();
    netMode = "solo";
    resetWorld(BOTS_SOLO);
    showPlay();
  }

  $("btnSolo").onclick = () => { unlockAudio(); startSolo(); };
  $("btnHost").onclick = () => { unlockAudio(); startHost(); };
  $("btnJoin").onclick = () => {
    ui.menu.classList.add("hidden");
    ui.join.classList.remove("hidden");
    ui.joinCode.value = "";
    ui.joinCode.focus();
  };
  $("btnJoinBack").onclick = () => { ui.join.classList.add("hidden"); ui.menu.classList.remove("hidden"); };
  $("btnJoinGo").onclick = () => startJoin(ui.joinCode.value);
  $("btnAgain").onclick = () => {
    unlockAudio();
    matchOver = false;
    if (netMode === "host") {
      const guests = [];
      for (const c of conns.values()) {
        const old = snakes.find((q) => q.id === c.pid);
        guests.push({ conn: c, name: old ? old.name : "玩家", color: old ? old.color : pick(COLORS) });
      }
      resetWorld(BOTS_MULTI);
      for (const g of guests) {
        const ns = makeSnake({ name: g.name, human: true, color: g.color, protect: 2500 });
        g.conn.pid = ns.id;
        if (g.conn.open) try { g.conn.send(JSON.stringify({ t: "rst", id: ns.id })); } catch (_) {}
      }
      showPlay();
      foodDirty = true;
      broadcastState();
    } else if (netMode === "client") {
      toast("等房主開新的一局");
    } else startSolo();
  };
  $("btnHome").onclick = showMenu;
  ui.exitBtn.onclick = () => { if (mode === "play" || mode === "dead") showMenu(); };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && (mode === "play" || mode === "dead")) showMenu();
  });
  $("copyRoom").onclick = async () => {
    const url = location.origin + location.pathname + "?room=" + roomCode;
    try {
      await navigator.clipboard.writeText("來玩大吃小！房間 " + roomCode + "\n" + url);
      toast("邀請已複製");
    } catch { toast("房間號是 " + roomCode); }
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
