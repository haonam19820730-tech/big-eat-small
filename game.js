(() => {
  const WORLD = 5200;
  const FOOD_N = 420;
  const BOTS_SOLO = 16;
  const BOTS_MULTI = 10;
  const MAX_HUMANS = 8;
  const START_MASS = 12;
  const EAT_RATIO = 1.12;
  const BOOST_COST = 7.2;
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
    "夜貓", "旋風", "糖糖", "黑鯊",
  ];

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });
  const $ = (id) => document.getElementById(id);
  const ui = {
    menu: $("menu"), join: $("join"), dead: $("dead"), hud: $("hud"),
    boost: $("boost"), board: $("board"), rank: $("rank"), score: $("score"),
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
  let foodDirty = true, netAcc = 0, toastTimer = 0, tipUntil = 0, respawnAt = 0;
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
  function radius(mass) { return 7.2 + Math.pow(Math.max(1, mass), 0.44) * 1.22; }
  function spacing(mass) { return Math.max(4.2, radius(mass) * 0.4); }
  function segs(mass) { return Math.max(14, (12 + mass * 0.62) | 0); }
  function speedOf(s) {
    const slow = 1 - Math.min(0.28, s.mass / 900);
    return (152 + 40 / (1 + radius(s.mass) * 0.04)) * slow * (s.boost ? 1.85 : 1);
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

  function addFood(x, y, value, color, special) {
    food.push({
      id: foodId++,
      x: x ?? rand(40, WORLD - 40),
      y: y ?? rand(40, WORLD - 40),
      value: value ?? (special ? rand(6, 12) : rand(1, 2.2)),
      color: color || (special ? "#ffd166" : pick(COLORS)),
      r: special ? rand(6, 9) : rand(2.6, 4.2),
      special: !!special,
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
      alive: true,
      bot: !!opts.bot,
      human: !!opts.human,
      pts,
      protect: performance.now() + (opts.protect || 1800),
      mood: "eat",
      moodT: 0,
      kills: 0,
    };
    snakes.push(s);
    return s;
  }

  function resetWorld(botCount) {
    food.length = 0; snakes.length = 0; bits.length = 0; feed.length = 0;
    foodId = 1; snakeId = 1; foodDirty = true;
    best = START_MASS; kills = 0; diedTo = "";
    for (let i = 0; i < FOOD_N; i++) addFood();
    for (let i = 0; i < 18; i++) {
      const cx = rand(400, WORLD - 400), cy = rand(400, WORLD - 400);
      for (let k = 0; k < 14; k++) addFood(cx + rand(-90, 90), cy + rand(-90, 90), rand(1.4, 3), pick(COLORS), false);
    }
    for (let i = 0; i < 10; i++) addFood(undefined, undefined, undefined, undefined, true);
    me = makeSnake({ name: playerName(), human: true, color: COLORS[0], protect: 2200 });
    for (let i = 0; i < botCount; i++) makeSnake({ bot: true, mass: rand(10, 28) });
    cam.x = me.pts[0].x; cam.y = me.pts[0].y; cam.z = 1;
    input.angle = me.angle;
    tipUntil = performance.now() + 3200;
    ui.tip.classList.add("show");
  }

  function dropBody(s, keep) {
    const n = clamp((s.pts.length * (1 - keep)) | 0, 8, 70);
    const step = Math.max(1, (s.pts.length / n) | 0);
    for (let i = 0; i < s.pts.length; i += step) {
      const p = s.pts[i];
      addFood(p.x + rand(-6, 6), p.y + rand(-6, 6), rand(1.6, 3.4), s.color, false);
    }
  }

  function kill(victim, eater) {
    if (!victim.alive) return;
    if (performance.now() < victim.protect) return;
    if (eater && performance.now() < eater.protect) return;
    victim.alive = false;
    victim.boost = false;
    burst(victim.pts[0].x, victim.pts[0].y, victim.color, 28, 280);
    dropBody(victim, 0.08);
    if (eater && eater.alive) {
      eater.mass += victim.mass * 0.42;
      eater.kills += 1;
      addFeed(eater.name + " 吃了 " + victim.name);
      if (eater === me) {
        kills += 1;
        cam.sx = 10;
        beep(220, 0.09, "sawtooth", 0.06);
        beep(440, 0.12, "square", 0.04);
      }
    } else addFeed(victim.name + " 掛了");
    if (victim === me) {
      best = Math.max(best, me.mass);
      diedTo = eater ? eater.name : "";
      beep(180, 0.28, "triangle", 0.07);
      if (netMode === "solo") {
        showDead(eater ? "被 " + eater.name + " 吃掉了" : "撞上去了", Math.floor(best), "本局最長");
      } else {
        toast(eater ? "被 " + eater.name + " 吃了，即將重生" : "掛了，即將重生");
        respawnAt = performance.now() + 1400;
      }
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
      if (o === s || !o.alive) continue;
      const d = Math.hypot(o.pts[0].x - head.x, o.pts[0].y - head.y);
      if (o.mass > s.mass * EAT_RATIO && d < 340 + radius(o.mass) * 4 && d < fd) {
        flee = o; fd = d;
      } else if (s.mass > o.mass * EAT_RATIO && d < 380 && d < hd) {
        hunt = o; hd = d;
      }
    }
    if (flee) {
      s.mood = "flee";
      s.targetAngle = Math.atan2(head.y - flee.pts[0].y, head.x - flee.pts[0].x) + rand(-0.2, 0.2);
      s.boost = fd < 170 && s.mass > 18;
      return;
    }
    if (hunt && (s.moodT <= 0 || s.mood === "hunt")) {
      s.mood = "hunt";
      s.moodT = rand(0.6, 1.4);
      const h = hunt.pts[0];
      const cut = hunt.pts[Math.min(8, hunt.pts.length - 1)];
      const aim = Math.random() < 0.55 ? cut : h;
      s.targetAngle = Math.atan2(aim.y - head.y, aim.x - head.x);
      s.boost = hd < 150 && s.mass > 20;
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
    const turn = (s.boost ? 4.6 : 3.35) * (20 / (10 + radius(s.mass)));
    const diff = norm(s.targetAngle - s.angle);
    s.angle += clamp(diff, -turn * dt, turn * dt);
    const sp = speedOf(s);
    let nx = s.pts[0].x + Math.cos(s.angle) * sp * dt;
    let ny = s.pts[0].y + Math.sin(s.angle) * sp * dt;
    const r = radius(s.mass);
    if (nx < r) { nx = r; s.angle = Math.PI - s.angle; s.targetAngle = s.angle; }
    if (nx > WORLD - r) { nx = WORLD - r; s.angle = Math.PI - s.angle; s.targetAngle = s.angle; }
    if (ny < r) { ny = r; s.angle = -s.angle; s.targetAngle = s.angle; }
    if (ny > WORLD - r) { ny = WORLD - r; s.angle = -s.angle; s.targetAngle = s.angle; }
    s.pts.unshift({ x: nx, y: ny });
    const spc = spacing(s.mass);
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      if (d !== spc) {
        b.x = a.x + (b.x - a.x) / d * spc;
        b.y = a.y + (b.y - a.y) / d * spc;
      }
    }
    const want = segs(s.mass);
    while (s.pts.length > want) s.pts.pop();
    while (s.pts.length < want) {
      const lastP = s.pts[s.pts.length - 1];
      s.pts.push({ x: lastP.x, y: lastP.y });
    }
    if (s.boost) {
      s.mass -= BOOST_COST * dt;
      if (s.mass < 10) { s.mass = 10; s.boost = false; }
      if (Math.random() < dt * 9 && food.length < FOOD_N + 80) {
        const tail = s.pts[s.pts.length - 1];
        addFood(tail.x, tail.y, 0.9, s.color, false);
      }
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
        if (d < r + f.r + 10) {
          f.x -= dx * 0.12; f.y -= dy * 0.12;
        }
        if (d < r + f.r * 0.2 && !f._eaten) { f._eaten = true; eaten.push(f); }
      });
      if (eaten.length) {
        for (const f of eaten) {
          s.mass += f.value;
          burst(f.x, f.y, f.color, f.special ? 10 : 3, 80);
          const ix = food.indexOf(f);
          if (ix >= 0) food.splice(ix, 1);
        }
        foodDirty = true;
        if (s === me) beep(660 + Math.min(400, s.mass), 0.04, "sine", 0.03);
        while (food.length < FOOD_N) addFood();
      }
    }
    for (const s of snakes) {
      if (!s.alive) continue;
      const head = s.pts[0];
      const r = radius(s.mass);
      nearby(bodyGrid, head.x, head.y, (item) => {
        if (!s.alive || item.s === s || !item.s.alive) return;
        if (item.i < 3) return;
        const hitR = (r + radius(item.s.mass)) * 0.58;
        const d = Math.hypot(item.x - head.x, item.y - head.y);
        if (d < hitR) {
          if (s.mass > item.s.mass * EAT_RATIO) kill(item.s, s);
          else kill(s, item.s);
        }
      });
    }
  }

  function simulate(dt) {
    t += dt;
    if (netMode !== "client") rebuildFoodGrid();
    if (netMode === "client") {
      if (me && me.alive) {
        me.targetAngle = input.angle;
        me.boost = input.boost && me.mass > 12;
        stepSnake(me, dt);
      }
    } else {
      if (me && me.alive) {
        me.targetAngle = input.angle;
        me.boost = input.boost && me.mass > 12;
      }
      for (const s of snakes) stepSnake(s, dt);
      eatAndFight();
      const wantBots = netMode === "solo" ? BOTS_SOLO : BOTS_MULTI;
      const liveBots = snakes.filter((s) => s.bot && s.alive).length;
      if (liveBots < wantBots) makeSnake({ bot: true, mass: rand(10, 24) });
      for (let i = snakes.length - 1; i >= 0; i--) {
        const s = snakes[i];
        if (!s.alive && s !== me) {
          s.gone = (s.gone || 0) + dt;
          if (s.gone > 0.9) snakes.splice(i, 1);
        }
      }
      if (me && me.alive) best = Math.max(best, me.mass);
      if (me && !me.alive && netMode !== "solo" && respawnAt && performance.now() >= respawnAt) {
        respawnAt = 0;
        const s = makeSnake({ name: me.name, human: true, color: me.color, id: me.id, protect: 2500 });
        snakes.splice(snakes.indexOf(me), 1);
        me = s;
        toast("重生了，先吃點變大");
      }
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
    if (!s.pts.length) return;
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
    ctx.globalAlpha = !s.alive ? 0.25 : flash ? 0.55 : 1;
    const step = s.pts.length > 70 ? 2 : 1;
    for (let i = s.pts.length - 1; i >= 0; i -= step) {
      const p = w2s(s.pts[i].x, s.pts[i].y);
      const k = i / (s.pts.length - 1 || 1);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.86 + 0.14 * k), 0, PI2);
      ctx.fill();
      if (i % (8 * step) === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.13)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.45, 0, PI2);
        ctx.fill();
      }
    }
    ctx.fillStyle = s.color;
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
    if (me && s !== me && s.alive) {
      const bigger = s.mass > me.mass * EAT_RATIO;
      const smaller = me.mass > s.mass * EAT_RATIO;
      if (bigger || smaller) {
        ctx.strokeStyle = bigger ? "rgba(255,80,110,0.9)" : "rgba(61,255,154,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(head.x, head.y, r + 6, 0, PI2);
        ctx.stroke();
      }
    }
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
      const wantZ = clamp(1.15 * (26 / radius(me.mass)), 0.42, 1.28);
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
    const ranked = snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
    const rank = ranked.indexOf(me) + 1;
    ui.rank.textContent = rank > 0 ? String(rank) : "-";
    ui.score.textContent = String(Math.floor(me.mass));
    ui.kills.textContent = String(kills);
    ui.board.innerHTML = ranked.slice(0, 6).map((s, i) =>
      `<div class="row ${s === me ? "me" : ""}"><span>${i + 1}. ${esc(s.name)}</span><span>${Math.floor(s.mass)}</span></div>`
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
  requestAnimationFrame((ts) => { last = ts; loop(ts); });

  function pointToAngle(x, y) {
    input.ax = x - W / 2;
    input.ay = y - H / 2;
    if (Math.hypot(input.ax, input.ay) > 8) input.angle = Math.atan2(input.ay, input.ax);
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
      p: snakes.map((s) => [
        s.id, s.pts[0].x, s.pts[0].y, s.angle, s.mass,
        s.boost ? 1 : 0, s.alive ? 1 : 0, s.name, s.color, s.human ? 1 : 0,
      ]),
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
      let s = snakes.find((q) => q.id === id);
      if (!s) {
        s = makeSnake({ id, name, color, human: !!human, bot: !human, pos: { x, y }, mass });
      } else if (!(me && id === me.id && me.alive)) {
        s.pts.unshift({ x, y });
        if (s.pts.length > segs(mass) + 4) s.pts.length = segs(mass);
      }
      s.angle = angle; s.mass = mass; s.boost = !!boost; s.alive = !!alive;
      s.name = name; s.color = color;
      if (me && id === me.id) me = s;
    }
    for (let i = snakes.length - 1; i >= 0; i--) if (!seen.has(snakes[i].id)) snakes.splice(i, 1);
    if (msg.f) {
      food.length = 0;
      for (const row of msg.f) food.push({ id: row[0], x: row[1], y: row[2], color: row[3], r: row[4], value: row[5], special: row[4] > 5.5 });
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
      if (s && s.alive) { s.targetAngle = msg.a; s.boost = !!msg.b && s.mass > 12; }
    }
    if (netMode === "client" && msg.t === "st") applyState(msg);
    if (msg.t === "hello" && netMode === "host") {
      if (snakes.filter((s) => s.human).length >= MAX_HUMANS) {
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
  }
  function wireConn(conn) {
    conn.on("data", (d) => onPeerData(conn, d));
    conn.on("close", () => {
      conns.delete(conn.peer);
      if (netMode === "host" && conn.pid) {
        const s = snakes.find((q) => q.id === conn.pid);
        if (s) kill(s, null);
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
    if (netMode === "host") {
      ui.dead.classList.add("hidden");
      const s = makeSnake({ name: me.name, human: true, color: me.color, id: me.id, protect: 2500 });
      snakes.splice(snakes.indexOf(me), 1);
      me = s; best = START_MASS; kills = 0;
      showPlay();
    } else startSolo();
  };
  $("btnHome").onclick = showMenu;
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
