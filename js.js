"use strict";

(function setupGlobalErrorNet() {
  function showFatalError(message) {
    try {
      let box = document.getElementById("__fatalErrorBox");
      if (!box) {
        box = document.createElement("div");
        box.id = "__fatalErrorBox";
        box.className = "__fatalErrorBox";
        document.body.appendChild(box);
      }
      box.textContent = "Game error (check browser console for full details):\n" + message;
    } catch (e) {}
  }
  window.addEventListener("error", (e) => {
    showFatalError((e.message || "Unknown error") + (e.filename ? ("\n" + e.filename + ":" + e.lineno) : ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    showFatalError("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
})();

const SUPABASE_URL = "https://jvcbtbvgptssoqimfpbn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DhMMBuISLiMGWDt-Xj42HQ_0820RWBZ";

let supabaseClient = null;
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  try {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return supabaseClient;
    }
  } catch (err) {
    console.error("Supabase init failed:", err);
  }
  return null;
}

function encodeUuidLocal(uuidNumber) {
  try {
    return btoa(String(uuidNumber));
  } catch (e) {
    return String(uuidNumber);
  }
}

function decodeUuidLocal(encoded) {
  try {
    return atob(encoded);
  } catch (e) {
    return encoded;
  }
}

function getLocalUuid() {
  try {
    const stored = window.localStorage ? window.localStorage.getItem("slither_uuid_b64") : null;
    if (stored) {
      const decoded = decodeUuidLocal(stored);
      const num = parseInt(decoded, 10);
      if (!isNaN(num)) return num;
    }
  } catch (e) {}
  return null;
}

function setLocalUuid(uuidNumber) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem("slither_uuid_b64", encodeUuidLocal(uuidNumber));
    }
  } catch (e) {}
}

function generateCandidateUuid() {
  return 1 + Math.floor(Math.random() * 2147483646);
}

async function ensureUniqueUuid() {
  const client = getSupabaseClient();
  let existing = getLocalUuid();
  if (existing !== null) return existing;

  if (!client) {
    const fallback = generateCandidateUuid();
    setLocalUuid(fallback);
    return fallback;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCandidateUuid();
    try {
      const { data, error } = await client.from("data").select("uuid").eq("uuid", candidate).limit(1);
      if (error) {
        console.error("UUID uniqueness check failed:", error.message || error);
        setLocalUuid(candidate);
        return candidate;
      }
      if (!data || data.length === 0) {
        setLocalUuid(candidate);
        return candidate;
      }
    } catch (err) {
      console.error("UUID uniqueness check exception:", err);
      setLocalUuid(candidate);
      return candidate;
    }
  }
  const fallback = generateCandidateUuid();
  setLocalUuid(fallback);
  return fallback;
}

async function upsertPlayerRow(fields) {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("Supabase unavailable; data was not saved online.");
    return false;
  }
  const uuid = await ensureUniqueUuid();
  try {
    const { data: existingRows, error: selectError } = await client
      .from("data")
      .select("uuid")
      .eq("uuid", uuid)
      .limit(1);
    if (selectError) {
      console.error("Supabase select-before-upsert failed:", selectError.message || selectError);
    }

    const rowExists = existingRows && existingRows.length > 0;
    const payload = Object.assign({ uuid: uuid }, fields);

    if (rowExists) {
      const { error } = await client.from("data").update(fields).eq("uuid", uuid);
      if (error) {
        console.error("Supabase update failed:", error.message || error);
        return false;
      }
    } else {
      const { error } = await client.from("data").insert([payload]);
      if (error) {
        console.error("Supabase insert failed:", error.message || error);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("Supabase upsert exception:", err);
    return false;
  }
}

async function syncLiveStats(name, latestScore, latestBoops) {
  const fields = {
    name: name,
    latest_score: Math.round(latestScore),
    latest_boops: Math.round(latestBoops),
    latest_score_time: new Date().toISOString(),
    latest_game_mode: "pva",
    current_game_mode: "pva"
  };

  const cachedBest = getCachedBest();
  if (!cachedBest || latestScore > cachedBest.best_score) {
    fields.best_score = Math.round(latestScore);
    fields.best_boops = Math.round(latestBoops);
    fields.best_score_time = new Date().toISOString();
    fields.best_game_mode = "pva";
    setCachedBest({ best_score: Math.round(latestScore), best_boops: Math.round(latestBoops), best_score_time: fields.best_score_time });
  }

  return upsertPlayerRow(fields);
}

let cachedBestStats = null;
function getCachedBest() {
  if (cachedBestStats) return cachedBestStats;
  try {
    const raw = window.localStorage ? window.localStorage.getItem("slither_best_cache") : null;
    if (raw) {
      cachedBestStats = JSON.parse(raw);
      return cachedBestStats;
    }
  } catch (e) {}
  return null;
}
function setCachedBest(obj) {
  cachedBestStats = obj;
  try {
    if (window.localStorage) window.localStorage.setItem("slither_best_cache", JSON.stringify(obj));
  } catch (e) {}
}

async function incrementGamesCount() {
  const client = getSupabaseClient();
  if (!client) return;
  const uuid = await ensureUniqueUuid();
  try {
    const { data: existingRows, error: selectError } = await client
      .from("data")
      .select("ai_games_count")
      .eq("uuid", uuid)
      .limit(1);
    if (selectError) {
      console.error("Supabase select-before-increment failed:", selectError.message || selectError);
    }
    const rowExists = existingRows && existingRows.length > 0;
    const currentCount = rowExists && existingRows[0].ai_games_count ? existingRows[0].ai_games_count : 0;
    const fields = { ai_games_count: currentCount + 1, current_game_mode: "pva" };
    if (rowExists) {
      await client.from("data").update(fields).eq("uuid", uuid);
    } else {
      await client.from("data").insert([Object.assign({ uuid: uuid, name: playerName || "" }, fields)]);
    }
  } catch (err) {
    console.error("Supabase increment games count exception:", err);
  }
}

async function fetchLeaderboard() {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("data")
      .select("name,latest_score,latest_boops,latest_score_time")
      .order("latest_score", { ascending: false })
      .limit(10);
    if (error) {
      console.error("Supabase select failed:", error.message || error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("Supabase select exception:", err);
    return [];
  }
}

async function fetchBestLeaderboard() {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("data")
      .select("name,best_score,best_boops,best_score_time")
      .order("best_score", { ascending: false })
      .limit(10);
    if (error) {
      console.error("Supabase best-select failed:", error.message || error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("Supabase best-select exception:", err);
    return [];
  }
}

const WORLD_SIZE = 60000;
const WORLD_RADIUS_MAX = 30000;
const WORLD_RADIUS_MIN = 10000;

const FOOD_MIN_RADIUS = 4;
const FOOD_MAX_RADIUS = 10;
const FOOD_MIN_VALUE = 1;
const FOOD_MAX_VALUE = 10;
const FOOD_DENSITY_PER_AREA = 0.00045;
const FOOD_MAX_CAP = 6000;
const FOOD_WOBBLE_RADIUS = 8;
const FOOD_WOBBLE_SPEED = 0.6;

const AI_COUNT_BASE = 499;

const BASE_SPEED = 156;
const BOOST_SPEED = 288;
const TURN_RATE = 5.4;
const BASE_SEGMENT_SPACING = 6.5;
const BASE_HEAD_RADIUS = 10;

const START_LENGTH = 20;
const SCORE_PER_KILL = 50;
const BOOPS_PER_KILL = 1;

const GROWTH_SLOWDOWN_START = 150;
const GROWTH_SLOWDOWN_MIN_MULT = 0.12;
const GROWTH_RATE_MULT = 0.35;

const MAX_THICKNESS_LENGTH = 6000;
const MIN_RADIUS_MULT = 1.0;
const MAX_RADIUS_MULT = 5.2;

const MIN_BOOST_LENGTH = 10;
const BOOST_TICK_INTERVAL = 100;
const BOOST_LENGTH_PER_TICK = 1;
const BOOST_FOOD_DROP_INTERVAL = 100;

const SHRINK_ANIM_SPEED = 8;
const GROW_ANIM_SPEED = 10;

const CAMERA_LERP = 0.08;

const COLLISION_CHECK_STEP = 1;

const FOOD_MAGNET_MULT = 0.5;

const SNAKE_COLORS = [
  ["#4fd6ff", "#1a9fd6"],
  ["#7cf29a", "#2fbf6a"],
  ["#ff6bd5", "#c93aa0"],
  ["#ffd166", "#e6a000"],
  ["#ff6b6b", "#d63838"],
  ["#b19dff", "#7b5cff"],
  ["#ff9f4f", "#e06e0e"],
  ["#5cf2e0", "#1fbfa8"],
];

const AI_NAME_BASES = [
  "Wriggler", "Noodle", "Fang", "Slick", "Viper", "Twister",
  "Zoomie", "Chomper", "Gobbler", "Coil", "Dash", "Squiggle",
  "Muncher", "Serpi", "Blip", "Nibbler", "Sassy", "Live",
  "Rony", "Butcher", "Maomao", "Sousou",
  "Slither", "Cobra", "Python", "Mamba", "Boa", "Adder", "Anaconda",
  "Rattler", "Sidewinder", "Copperhead", "Krait", "Taipan", "Vine",
  "Ribbon", "Whip", "Lasher", "Tangle", "Curl", "Spiral", "Loop",
  "Zigzag", "Weave", "Snap", "Bolt", "Flash", "Streak", "Blitz",
  "Turbo", "Rocket", "Comet", "Meteor", "Nova", "Blaze", "Ember",
  "Frost", "Glacier", "Storm", "Thunder", "Cyclone", "Tornado",
  "Quake", "Ripple", "Wave", "Current", "Undertow", "Tide",
  "Shadow", "Ghost", "Phantom", "Specter", "Wraith", "Reaper",
  "Fang2", "Venom", "Toxin", "Poison", "Sting", "Bite", "Snare",
  "Trap", "Hunter", "Stalker", "Prowler", "Predator", "Scout",
  "Rogue", "Bandit", "Outlaw", "Renegade", "Maverick", "Nomad",
  "Wanderer", "Drifter", "Rambler", "Roamer", "Voyager", "Pioneer",
  "Titan", "Colossus", "Behemoth", "Juggernaut", "Goliath", "Atlas",
  "Apex", "Zenith", "Summit", "Peak", "Crest", "Pinnacle",
  "Glimmer", "Sparkle", "Shine", "Glow", "Radiance", "Luster",
  "Mystic", "Oracle", "Sage", "Seer", "Wizard", "Sorcerer",
  "Ace", "Champ", "Legend", "Icon", "Rookie", "Veteran"
];

function makeAIName() {
  const base = AI_NAME_BASES[(Math.random() * AI_NAME_BASES.length) | 0];
  return base + " (bot)";
}

const DIFFICULTY_PRESETS = {
  easy: {
    huntChance: 0.05,
    huntRange: 260,
    boostChanceSeek: 0.006,
    boostChanceHunt: 0.008,
    boostChanceFlee: 0.02,
    reactionSlack: 0.35,
    aggressionSpeedMult: 0.95,
    avoidSkill: 0.7
  },
  medium: {
    huntChance: 0.1,
    huntRange: 380,
    boostChanceSeek: 0.008,
    boostChanceHunt: 0.014,
    boostChanceFlee: 0.03,
    reactionSlack: 0.15,
    aggressionSpeedMult: 1.0,
    avoidSkill: 0.85
  },
  hard: {
    huntChance: 0.2,
    huntRange: 560,
    boostChanceSeek: 0.012,
    boostChanceHunt: 0.022,
    boostChanceFlee: 0.045,
    reactionSlack: 0.0,
    aggressionSpeedMult: 1.08,
    avoidSkill: 1.0
  }
};

let currentDifficulty = "medium";
function getDifficulty() {
  return DIFFICULTY_PRESETS[currentDifficulty] || DIFFICULTY_PRESETS.medium;
}

let graphicsQuality = "high";

let canvas, ctx, minimapCanvas, minimapCtx;
let W = window.innerWidth, H = window.innerHeight;

let gameRunning = false;
let playerName = "";

let player = null;
let aiSnakes = [];
let foods = [];

let camera = { x: 0, y: 0, zoom: 1 };

let lastTime = 0;
let fps = 0;
let fpsAccum = 0;
let fpsFrames = 0;

let worldRadius = WORLD_RADIUS_MAX;

function updateWorldRadius() {
  const totalSnakes = 1 + aiSnakes.length;
  const t = Math.min(1, totalSnakes / 500);
  worldRadius = WORLD_RADIUS_MAX - t * (WORLD_RADIUS_MAX - WORLD_RADIUS_MIN);
}

function getFoodTarget() {
  const area = Math.PI * worldRadius * worldRadius;
  return Math.min(1400, Math.max(200, Math.round(area * FOOD_DENSITY_PER_AREA)));
}

const input = {
  mouseX: W / 2,
  mouseY: H / 2,
  boosting: false
};

function setupInput() {
  window.addEventListener("mousemove", (e) => {
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;
  });

  window.addEventListener("mousedown", () => { input.boosting = true; });
  window.addEventListener("mouseup", () => { input.boosting = false; });
  window.addEventListener("contextmenu", (e) => {
    if (gameRunning) e.preventDefault();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { input.boosting = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") { input.boosting = false; e.preventDefault(); }
  });

  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    if (canvas) {
      canvas.width = W;
      canvas.height = H;
    }
  });
}

function zoomForLength(length) {
  const t = Math.min(1, Math.max(0, (length - START_LENGTH) / 2000));
  return 2.3 - t * 1.5;
}

function updateCamera(target) {
  if (!target) return;
  const desiredX = target.segments[0].x;
  const desiredY = target.segments[0].y;
  camera.x += (desiredX - camera.x) * CAMERA_LERP;
  camera.y += (desiredY - camera.y) * CAMERA_LERP;
  const targetZoom = zoomForLength(target.length);
  camera.zoom += (targetZoom - camera.zoom) * 0.05;
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom + W / 2,
    y: (y - camera.y) * camera.zoom + H / 2
  };
}

function randomFoodColor() {
  const colors = ["#ffd166", "#4fd6ff", "#ff6bd5", "#7cf29a", "#ff9f4f", "#5cf2e0"];
  return colors[(Math.random() * colors.length) | 0];
}

function radiusForFoodValue(value) {
  const t = (value - FOOD_MIN_VALUE) / (FOOD_MAX_VALUE - FOOD_MIN_VALUE);
  return FOOD_MIN_RADIUS + t * (FOOD_MAX_RADIUS - FOOD_MIN_RADIUS);
}

function spawnFood(x, y, value, color) {
  const clampedValue = Math.max(FOOD_MIN_VALUE, Math.min(FOOD_MAX_VALUE, value || 1));
  foods.push({
    baseX: x,
    baseY: y,
    x, y,
    radius: radiusForFoodValue(clampedValue),
    color: color || randomFoodColor(),
    value: clampedValue,
    pulse: Math.random() * Math.PI * 2,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: FOOD_WOBBLE_SPEED * (0.7 + Math.random() * 0.6)
  });
}

function randomPointInWorld(marginFromEdge) {
  const maxR = Math.max(10, worldRadius - (marginFromEdge || 0));
  const r = maxR * Math.sqrt(Math.random());
  const theta = Math.random() * Math.PI * 2;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

function fillFoodToTarget() {
  const target = getFoodTarget();
  while (foods.length < target) {
    const roll = Math.random();
    let value = 1;
    if (roll > 0.985) value = 5 + Math.floor(Math.random() * 6);
    else if (roll > 0.9) value = 2 + Math.floor(Math.random() * 3);
    const p = randomPointInWorld(30);
    spawnFood(p.x, p.y, value);
  }
  if (foods.length > target + 200) {
    foods.length = target;
  }
}

function updateFoodWobble(dt) {
  const dtSeconds = Math.min(dt, 100) / 1000;
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i];
    const distFromCenter = Math.hypot(f.baseX, f.baseY);
    if (distFromCenter > worldRadius) {
      foods.splice(i, 1);
      continue;
    }
    f.wobblePhase += f.wobbleSpeed * dtSeconds;
    f.x = f.baseX + Math.cos(f.wobblePhase) * FOOD_WOBBLE_RADIUS;
    f.y = f.baseY + Math.sin(f.wobblePhase * 1.3) * FOOD_WOBBLE_RADIUS;
  }
}

class Snake {
  constructor(x, y, name, colorPair, isPlayer) {
    this.name = name;
    this.isPlayer = !!isPlayer;
    this.alive = true;
    this.color1 = colorPair[0];
    this.color2 = colorPair[1];
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.speed = BASE_SPEED;
    this.boosting = false;
    this.boops = 0;

    this.segmentCount = START_LENGTH;
    this.displaySegmentCount = START_LENGTH;
    this.path = [];
    const pathPoints = START_LENGTH * 6;
    for (let i = 0; i < pathPoints; i++) {
      this.path.push({
        x: x - Math.cos(this.angle) * i * (BASE_SEGMENT_SPACING / 6),
        y: y - Math.sin(this.angle) * i * (BASE_SEGMENT_SPACING / 6)
      });
    }
    this.segments = [];
    this.rebuildSegmentsFromPath();

    this.growthRemaining = 0;
    this.eyeBlink = 0;

    this.boostTickAccum = 0;
    this.boostFoodDropAccum = 0;
  }

  get headRadius() {
    const t = Math.min(1, this.displaySegmentCount / MAX_THICKNESS_LENGTH);
    const mult = MIN_RADIUS_MULT + t * (MAX_RADIUS_MULT - MIN_RADIUS_MULT);
    return BASE_HEAD_RADIUS * mult;
  }

  get segmentSpacing() {
    return BASE_SEGMENT_SPACING * (this.headRadius / BASE_HEAD_RADIUS) * 0.9;
  }

  applyTurn(dtSeconds) {
    let diff = this.targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dtSeconds;
    if (diff > maxTurn) diff = maxTurn;
    if (diff < -maxTurn) diff = -maxTurn;
    this.angle += diff;
  }

  move(dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;

    this.applyTurn(dtSeconds);

    const canBoost = this.segmentCount > MIN_BOOST_LENGTH;
    const boosting = this.boosting && canBoost;
    const speedMult = this.isPlayer ? 1 : getDifficulty().aggressionSpeedMult;
    this.speed = (boosting ? BOOST_SPEED : BASE_SPEED) * speedMult;

    const head = this.path[0];
    const moveDist = this.speed * dtSeconds;
    const nx = head.x + Math.cos(this.angle) * moveDist;
    const ny = head.y + Math.sin(this.angle) * moveDist;

    this.path.unshift({ x: nx, y: ny });

    if (this.growthRemaining > 0) {
      this.segmentCount += 1;
      this.growthRemaining -= 1;
    }

    if (boosting) {
      this.boostTickAccum += dt;
      while (this.boostTickAccum >= BOOST_TICK_INTERVAL) {
        this.boostTickAccum -= BOOST_TICK_INTERVAL;
        if (this.segmentCount > MIN_BOOST_LENGTH) {
          this.segmentCount = Math.max(MIN_BOOST_LENGTH, this.segmentCount - BOOST_LENGTH_PER_TICK);
        } else {
          this.boosting = false;
        }
      }

      this.boostFoodDropAccum += dt;
      while (this.boostFoodDropAccum >= BOOST_FOOD_DROP_INTERVAL) {
        this.boostFoodDropAccum -= BOOST_FOOD_DROP_INTERVAL;
        const tailIdx = this.segments.length - 1;
        const tail = this.segments[tailIdx];
        if (tail) spawnFood(tail.x, tail.y, 1, this.color1);
      }
    } else {
      this.boostTickAccum = 0;
      this.boostFoodDropAccum = 0;
    }

    const maxPathLen = Math.ceil(this.segmentCount * this.segmentSpacing) + 40;
    if (this.path.length > maxPathLen) this.path.length = maxPathLen;

    this.rebuildSegmentsFromPath();

    if (this.displaySegmentCount > this.segmentCount) {
      this.displaySegmentCount -= SHRINK_ANIM_SPEED * dtSeconds;
      if (this.displaySegmentCount < this.segmentCount) this.displaySegmentCount = this.segmentCount;
    } else if (this.displaySegmentCount < this.segmentCount) {
      this.displaySegmentCount += GROW_ANIM_SPEED * dtSeconds;
      if (this.displaySegmentCount > this.segmentCount) this.displaySegmentCount = this.segmentCount;
    }

    this.eyeBlink += dtSeconds * 5;
  }

  rebuildSegmentsFromPath() {
    const spacing = this.segmentSpacing;
    const path = this.path;
    const result = [path[0]];
    let prev = path[0];
    let accum = 0;
    let idx = 1;

    while (result.length < this.segmentCount) {
      if (idx >= path.length) {
        result.push(path[path.length - 1]);
        continue;
      }
      const cur = path[idx];
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      const segDist = Math.hypot(dx, dy);
      if (segDist < 1e-6) { idx++; continue; }
      if (accum + segDist >= spacing) {
        const t = (spacing - accum) / segDist;
        const px = prev.x + dx * t;
        const py = prev.y + dy * t;
        result.push({ x: px, y: py });
        prev = { x: px, y: py };
        accum = 0;
      } else {
        accum += segDist;
        prev = cur;
        idx++;
      }
    }

    this.segments = result;
  }

  growthMultiplierForCurrentSize() {
    if (this.segmentCount <= GROWTH_SLOWDOWN_START) return 1;
    const over = this.segmentCount - GROWTH_SLOWDOWN_START;
    const falloff = Math.exp(-over / 500);
    return GROWTH_SLOWDOWN_MIN_MULT + (1 - GROWTH_SLOWDOWN_MIN_MULT) * falloff;
  }

  grow(amount) {
    const adjusted = amount * this.growthMultiplierForCurrentSize();
    this.growthRemaining += adjusted;
  }

  eat(foodValue) {
    this.grow(foodValue * GROWTH_RATE_MULT);
  }

  registerKill() {
    this.grow(SCORE_PER_KILL);
    this.boops += BOOPS_PER_KILL;
  }

  get length() {
    return Math.round(this.segmentCount);
  }

  get score() {
    return this.length;
  }
}

class AISnake extends Snake {
  constructor(x, y, name, colorPair) {
    super(x, y, name, colorPair, false);
    this.wanderTimer = 0;
    this.wanderAngle = this.angle;
    this.state = "wander";
    this.huntCommit = 0;
    this.huntTargetIsPlayer = false;
    this.stickyFoodTarget = null;
    this.threatAssessTimer = 0;
    this.fleeing = false;
    this.fleeFrom = null;
    this.lastBoostBurst = 0;
    this.lodSkipCounter = Math.floor(Math.random() * 3);
  }

  scanThreats(allSnakes, checkX, checkY, lookAhead) {
    const dangerMargin = this.headRadius + 60;
    const threats = [];
    const seenSnakes = new Set();

    forEachNearbySegment(checkX, checkY, dangerMargin * 2.2, (entry) => {
      if (entry.snake === this && entry.index < 8) return false;
      if (!entry.snake.alive) return false;
      const seg = entry.seg;
      const dx = seg.x - checkX, dy = seg.y - checkY;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < (dangerMargin * 2.2) * (dangerMargin * 2.2)) {
        if (!seenSnakes.has(entry.snake)) {
          seenSnakes.add(entry.snake);
          threats.push({ snake: entry.snake, seg, dist2, isSelf: entry.snake === this });
        } else {
          for (let t of threats) {
            if (t.snake === entry.snake && dist2 < t.dist2) {
              t.seg = seg;
              t.dist2 = dist2;
            }
          }
        }
      }
      return false;
    });

    return threats;
  }

  think(allSnakes, dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const diff = getDifficulty();
    const head = this.segments[0];
    const turnRadius = this.speed / TURN_RATE;

    let closestFood = null;
    let closestFoodScore = -Infinity;
    const searchRadius = 420;

    if (this.stickyFoodTarget) {
      const f = this.stickyFoodTarget;
      const stillExists = foods.indexOf(f) !== -1;
      if (!stillExists) {
        this.stickyFoodTarget = null;
      } else {
        const dx = f.x - head.x, dy = f.y - head.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > (searchRadius * 1.4) * (searchRadius * 1.4)) {
          this.stickyFoodTarget = null;
        } else {
          closestFood = f;
        }
      }
    }

    if (!closestFood) {
      let bestFood = null;
      let bestScore = -Infinity;
      forEachNearbyFood(head.x, head.y, searchRadius, (f) => {
        const dx = f.x - head.x, dy = f.y - head.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= searchRadius * searchRadius) return false;

        const angleToFood = Math.atan2(dy, dx);
        let turnNeeded = angleToFood - this.angle;
        while (turnNeeded > Math.PI) turnNeeded -= Math.PI * 2;
        while (turnNeeded < -Math.PI) turnNeeded += Math.PI * 2;
        const dist = Math.sqrt(d2);

        const reachable = dist > turnRadius * 0.6 || Math.abs(turnNeeded) < 0.5;
        if (!reachable) return false;

        const bucket = spatialFoodGrid.get(cellKey(f.x, f.y));
        const nearbyBonus = bucket ? bucket.length : 1;

        const distScore = 1 - Math.min(1, dist / searchRadius);
        const turnScore = 1 - Math.min(1, Math.abs(turnNeeded) / Math.PI);
        const valueScore = f.value / FOOD_MAX_VALUE;
        const clusterScore = Math.min(1, nearbyBonus / 8);
        const score = distScore * 0.4 + turnScore * 0.25 + valueScore * 0.15 + clusterScore * 0.2;

        if (score > bestScore) {
          bestScore = score;
          bestFood = f;
        }
        return false;
      });
      if (bestFood) {
        closestFood = bestFood;
        this.stickyFoodTarget = bestFood;
      }
    }

    const lookAhead = this.headRadius * 6 + turnRadius * 0.6 + 50;
    const checkX = head.x + Math.cos(this.angle) * lookAhead;
    const checkY = head.y + Math.sin(this.angle) * lookAhead;
    const noticesDanger = Math.random() < diff.avoidSkill;

    let avoidAngle = null;
    let avoidWasOwnTail = false;
    let mostUrgentThreat = null;
    let opportunityTarget = null;

    if (noticesDanger) {
      const threats = this.scanThreats(allSnakes, checkX, checkY, lookAhead);
      const dangerMargin = this.headRadius + 60;

      let worstUrgency = -Infinity;
      for (let t of threats) {
        if (t.isSelf) continue;
        const otherHead = t.snake.segments[0];
        const headDx = otherHead.x - head.x, headDy = otherHead.y - head.y;
        const headDist = Math.hypot(headDx, headDy);
        const closingAngle = Math.atan2(headDy, headDx);
        const otherHeading = t.snake.angle;
        let headOnFactor = Math.cos(otherHeading - (closingAngle + Math.PI));
        const proximityUrgency = 1 - Math.min(1, Math.sqrt(t.dist2) / (dangerMargin * 2.2));
        const headOnUrgency = Math.max(0, headOnFactor) * 0.5;
        const sizeUrgency = t.snake.length > this.length * 1.1 ? 0.6 : 0.1;
        const urgency = proximityUrgency + headOnUrgency + sizeUrgency;

        if (Math.sqrt(t.dist2) < dangerMargin && urgency > worstUrgency) {
          worstUrgency = urgency;
          mostUrgentThreat = t;
        }
      }

      for (let t of threats) {
        if (t.isSelf) continue;
        if (t.snake.length < this.length * 0.7 && Math.sqrt(t.dist2) < dangerMargin * 1.8) {
          const otherHead = t.snake.segments[0];
          const d = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
          if (!opportunityTarget || d < opportunityTarget.dist) {
            opportunityTarget = { snake: t.snake, dist: d };
          }
        }
      }

      if (mostUrgentThreat) {
        const seg = mostUrgentThreat.seg;
        const escapeAngle = Math.atan2(head.y - seg.y, head.x - seg.x);
        let turnToEscape = escapeAngle - this.angle;
        while (turnToEscape > Math.PI) turnToEscape -= Math.PI * 2;
        while (turnToEscape < -Math.PI) turnToEscape += Math.PI * 2;
        avoidAngle = this.angle + (turnToEscape >= 0 ? Math.PI / 2 : -Math.PI / 2);
        avoidWasOwnTail = mostUrgentThreat.isSelf;
      }
    }

    const margin = 300;
    let edgeAngle = null;
    const distFromCenter = Math.hypot(head.x, head.y);
    if (distFromCenter > worldRadius - margin - turnRadius) {
      edgeAngle = Math.atan2(-head.y, -head.x);
    }

    this.threatAssessTimer -= dtSeconds;
    if (this.threatAssessTimer <= 0) {
      this.threatAssessTimer = 0.25;
      this.fleeing = false;
      this.fleeFrom = null;
      if (mostUrgentThreat && !avoidWasOwnTail) {
        if (mostUrgentThreat.snake.length > this.length * 1.15) {
          this.fleeing = true;
          this.fleeFrom = mostUrgentThreat.snake;
        }
      }
    }

    let huntAngle = null;
    let huntingOpportunity = false;
    if (opportunityTarget && !this.fleeing) {
      huntAngle = Math.atan2(
        opportunityTarget.snake.segments[0].y - head.y,
        opportunityTarget.snake.segments[0].x - head.x
      );
      this.huntTargetIsPlayer = opportunityTarget.snake.isPlayer;
      huntingOpportunity = true;
      this.state = "hunt";
    } else if (player && player.alive && !avoidWasOwnTail) {
      const dxp = player.segments[0].x - head.x;
      const dyp = player.segments[0].y - head.y;
      const distp2 = dxp * dxp + dyp * dyp;
      const inRange = distp2 < diff.huntRange * diff.huntRange;
      const muchBigger = this.length > player.length * 1.3;
      const muchSmaller = player.length > this.length * 1.3;
      const sizeOk = muchBigger && !muchSmaller;

      if (this.huntCommit > 0) {
        this.huntCommit -= dtSeconds;
      } else if (inRange && sizeOk && Math.random() < diff.huntChance) {
        this.huntCommit = 1.5 + Math.random() * 2;
      }

      if (this.huntCommit > 0 && inRange && sizeOk) {
        let aimX = player.segments[0].x;
        let aimY = player.segments[0].y;
        if (currentDifficulty === "hard") {
          aimX += Math.cos(player.angle) * 60;
          aimY += Math.sin(player.angle) * 60;
        }
        huntAngle = Math.atan2(aimY - head.y, aimX - head.x);
        this.huntTargetIsPlayer = true;
      } else {
        this.huntTargetIsPlayer = false;
        this.huntCommit = 0;
      }
    } else {
      this.huntTargetIsPlayer = false;
      this.huntCommit = 0;
    }

    let desiredAngle;
    if (avoidAngle !== null) {
      desiredAngle = avoidAngle;
      this.state = "avoid";
      this.stickyFoodTarget = null;
    } else if (edgeAngle !== null) {
      desiredAngle = edgeAngle;
      this.state = "edge";
    } else if (huntAngle !== null) {
      desiredAngle = huntAngle;
      if (!huntingOpportunity) this.state = "hunt";
    } else if (closestFood) {
      desiredAngle = Math.atan2(closestFood.y - head.y, closestFood.x - head.x);
      this.state = "seek";
    } else {
      this.wanderTimer -= dtSeconds;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = this.angle + (Math.random() - 0.5) * 1.4;
        this.wanderTimer = 0.67 + Math.random() * 1.0;
      }
      desiredAngle = this.wanderAngle;
      this.state = "wander";
    }

    if (diff.reactionSlack > 0) {
      let da = desiredAngle - this.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      desiredAngle = this.angle + da * (1 - diff.reactionSlack) + (Math.random() - 0.5) * diff.reactionSlack;
    }

    this.targetAngle = desiredAngle;

    this.lastBoostBurst -= dtSeconds;
    const frameNormalizer = dtSeconds * 60;
    if (this.segments.length > 60) {
      if (this.fleeing && avoidAngle !== null && this.lastBoostBurst <= 0) {
        this.boosting = Math.random() < diff.boostChanceFlee * frameNormalizer * 2;
        if (this.boosting) this.lastBoostBurst = 0.4;
      } else if (huntingOpportunity && opportunityTarget && opportunityTarget.dist < turnRadius * 1.5) {
        this.boosting = Math.random() < diff.boostChanceHunt * frameNormalizer * 1.8;
      } else if (this.state === "hunt" && !huntingOpportunity) {
        this.boosting = Math.random() < diff.boostChanceHunt * frameNormalizer;
      } else if (this.state === "seek" && closestFood) {
        const fd = Math.hypot(closestFood.x - head.x, closestFood.y - head.y);
        this.boosting = fd < turnRadius * 1.2 && Math.random() < diff.boostChanceSeek * frameNormalizer;
      } else {
        this.boosting = false;
      }
    } else {
      this.boosting = false;
    }
  }
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

const SPATIAL_CELL_SIZE = 120;
let spatialSegmentGrid = new Map();
let spatialFoodGrid = new Map();

function cellKey(x, y) {
  const cx = Math.floor(x / SPATIAL_CELL_SIZE);
  const cy = Math.floor(y / SPATIAL_CELL_SIZE);
  return cx + "," + cy;
}

function rebuildSpatialGrids(allSnakes) {
  spatialSegmentGrid = new Map();
  spatialFoodGrid = new Map();

  for (let snake of allSnakes) {
    const segs = snake.segments;
    for (let i = 0; i < segs.length; i += COLLISION_CHECK_STEP) {
      const key = cellKey(segs[i].x, segs[i].y);
      let bucket = spatialSegmentGrid.get(key);
      if (!bucket) { bucket = []; spatialSegmentGrid.set(key, bucket); }
      bucket.push({ snake, seg: segs[i], index: i });
    }
  }

  for (let f of foods) {
    const key = cellKey(f.x, f.y);
    let bucket = spatialFoodGrid.get(key);
    if (!bucket) { bucket = []; spatialFoodGrid.set(key, bucket); }
    bucket.push(f);
  }
}

function forEachNearbySegment(x, y, radius, callback) {
  const minCx = Math.floor((x - radius) / SPATIAL_CELL_SIZE);
  const maxCx = Math.floor((x + radius) / SPATIAL_CELL_SIZE);
  const minCy = Math.floor((y - radius) / SPATIAL_CELL_SIZE);
  const maxCy = Math.floor((y + radius) / SPATIAL_CELL_SIZE);

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const bucket = spatialSegmentGrid.get(cx + "," + cy);
      if (!bucket) continue;
      for (let entry of bucket) {
        if (callback(entry) === true) return;
      }
    }
  }
}

function forEachNearbyFood(x, y, radius, callback) {
  const minCx = Math.floor((x - radius) / SPATIAL_CELL_SIZE);
  const maxCx = Math.floor((x + radius) / SPATIAL_CELL_SIZE);
  const minCy = Math.floor((y - radius) / SPATIAL_CELL_SIZE);
  const maxCy = Math.floor((y + radius) / SPATIAL_CELL_SIZE);

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const bucket = spatialFoodGrid.get(cx + "," + cy);
      if (!bucket) continue;
      for (let f of bucket) {
        if (callback(f) === true) return;
      }
    }
  }
}

function killSnake(snake, killer) {
  snake.alive = false;

  const segs = snake.segments;
  const totalValue = Math.max(1, snake.length);
  const dropSpacing = 3;
  const dropCount = Math.max(1, Math.floor(segs.length / dropSpacing));
  const valuePerDrop = Math.min(FOOD_MAX_VALUE, Math.max(FOOD_MIN_VALUE, Math.round(totalValue / dropCount / 2)));
  for (let i = 0; i < segs.length; i += dropSpacing) {
    spawnFood(segs[i].x, segs[i].y, valuePerDrop, snake.color1);
  }

  if (killer && killer.alive && killer !== snake) {
    killer.registerKill();
  }

  if (snake.isPlayer) {
    onPlayerDeath();
  }
}

function applyFoodMagnet(snake) {
  const head = snake.segments[0];
  const magnetRadius = snake.headRadius * FOOD_MAGNET_MULT;
  if (magnetRadius <= 0) return;
  forEachNearbyFood(head.x, head.y, magnetRadius + FOOD_MAX_RADIUS, (f) => {
    const dx = head.x - f.baseX, dy = head.y - f.baseY;
    const dist = Math.hypot(dx, dy);
    if (dist < magnetRadius && dist > 0.01) {
      const pull = Math.min(1, (magnetRadius - dist) / magnetRadius) * 6;
      f.baseX += (dx / dist) * pull;
      f.baseY += (dy / dist) * pull;
    }
    return false;
  });
}

function checkCollisions() {
  const allSnakes = [player, ...aiSnakes].filter(s => s && s.alive);
  rebuildSpatialGrids(allSnakes);

  for (let snake of allSnakes) {
    if (!snake.alive) continue;
    const head = snake.segments[0];
    const headR = snake.headRadius;

    const distFromCenter = Math.hypot(head.x, head.y);
    if (distFromCenter + headR >= worldRadius) {
      killSnake(snake, null);
      continue;
    }

    applyFoodMagnet(snake);

    const foodSearchR = headR + FOOD_MAX_RADIUS + 5;
    const eatenFoods = [];
    forEachNearbyFood(head.x, head.y, foodSearchR, (f) => {
      const rr = (headR + f.radius);
      if (distSq(head.x, head.y, f.x, f.y) < rr * rr) {
        eatenFoods.push(f);
      }
      return false;
    });
    if (eatenFoods.length > 0) {
      for (let f of eatenFoods) {
        snake.eat(f.value);
        const idx = foods.indexOf(f);
        if (idx !== -1) foods.splice(idx, 1);
      }
      if (snake.isPlayer) {
        syncLiveStats(playerName, snake.length, snake.boops);
      }
    }

    const collisionSearchR = headR * 0.8 + MAX_RADIUS_MULT * BASE_HEAD_RADIUS * 0.8 + 5;
    let killerHit = null;
    forEachNearbySegment(head.x, head.y, collisionSearchR, (entry) => {
      if (entry.snake === snake) return false;
      if (!entry.snake.alive) return false;
      if (entry.index === 0) return false;
      const otherR = entry.snake.headRadius;
      const rr = (headR * 0.8 + otherR * 0.8);
      if (distSq(head.x, head.y, entry.seg.x, entry.seg.y) < rr * rr) {
        killerHit = entry.snake;
        return true;
      }
      return false;
    });
    if (killerHit) {
      killSnake(snake, killerHit);
      if (killerHit.isPlayer) {
        syncLiveStats(playerName, killerHit.length, killerHit.boops);
      }
    }
  }

  aiSnakes = aiSnakes.filter(s => s.alive);

  const missing = AI_COUNT_BASE - aiSnakes.length;
  const spawnBatch = Math.min(missing, 5);
  for (let i = 0; i < spawnBatch; i++) {
    spawnOneAI();
  }

  fillFoodToTarget();
}

function randomSpawnPoint() {
  return randomPointInWorld(400);
}

function spawnOneAI() {
  const pos = randomSpawnPoint();
  const name = makeAIName();
  const colorPair = SNAKE_COLORS[(Math.random() * SNAKE_COLORS.length) | 0];
  aiSnakes.push(new AISnake(pos.x, pos.y, name, colorPair));
}

function initAISnakes() {
  aiSnakes = [];
  for (let i = 0; i < AI_COUNT_BASE; i++) spawnOneAI();
}

function renderLeaderboardList(listEl, data, nameField, scoreField, highlightName) {
  listEl.innerHTML = "";
  if (!data || data.length === 0) {
    const li = document.createElement("li");
    li.className = "lb-empty";
    li.textContent = "No scores yet";
    listEl.appendChild(li);
    return;
  }
  data.forEach((row, idx) => {
    const li = document.createElement("li");
    if (highlightName && row[nameField] === highlightName) li.classList.add("me");
    const rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = "#" + (idx + 1);
    const nameSpan = document.createElement("span");
    nameSpan.className = "lname";
    nameSpan.textContent = row[nameField] || "???";
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "lscore";
    scoreSpan.textContent = row[scoreField];
    li.appendChild(rankSpan);
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    listEl.appendChild(li);
  });
}

let liveLeaderboardThrottle = 0;
function updateLiveLeaderboard(dt) {
  liveLeaderboardThrottle += dt;
  if (liveLeaderboardThrottle < 500) return;
  liveLeaderboardThrottle = 0;

  const liveList = document.getElementById("liveLeaderboardList");
  if (!liveList) return;

  const all = [player, ...aiSnakes].filter(s => s && s.alive);
  const sorted = all.slice().sort((a, b) => b.length - a.length).slice(0, 10);

  liveList.innerHTML = "";
  sorted.forEach((s, idx) => {
    const li = document.createElement("li");
    if (s.isPlayer) li.classList.add("me");
    const rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = "#" + (idx + 1);
    const swatch = document.createElement("span");
    swatch.className = "lswatch";
    swatch.style.background = s.color1;
    const nameSpan = document.createElement("span");
    nameSpan.className = "lname";
    nameSpan.textContent = s.name || "(unnamed)";
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "lscore";
    scoreSpan.textContent = s.length;
    li.appendChild(rankSpan);
    li.appendChild(swatch);
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    liveList.appendChild(li);
  });
}

async function refreshLeaderboard() {
  const data = await fetchLeaderboard();
  const menuList = document.getElementById("menuLeaderboardList");
  if (menuList) renderLeaderboardList(menuList, data, "name", "latest_score", playerName);
}

async function refreshTopLeaderboard() {
  const data = await fetchBestLeaderboard();
  const topList = document.getElementById("topLeaderboardList");
  if (topList) renderLeaderboardList(topList, data, "name", "best_score", playerName);
}

function startLeaderboardPolling() {
  refreshLeaderboard();
  setInterval(refreshLeaderboard, 10000);
}

function formatTimestamp(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (e) {
    return "-";
  }
}

function loadLocalStats() {
  let last = null;
  let best = null;
  try {
    const lastRaw = window.localStorage ? window.localStorage.getItem("slither_last_game") : null;
    const bestRaw = window.localStorage ? window.localStorage.getItem("slither_best_game") : null;
    if (lastRaw) last = JSON.parse(lastRaw);
    if (bestRaw) best = JSON.parse(bestRaw);
  } catch (e) {}
  return { last, best };
}

function saveLocalStats(length, boops) {
  const record = { length, boops, when: new Date().toISOString() };
  try {
    if (window.localStorage) {
      window.localStorage.setItem("slither_last_game", JSON.stringify(record));
      const bestRaw = window.localStorage.getItem("slither_best_game");
      let best = null;
      if (bestRaw) {
        try { best = JSON.parse(bestRaw); } catch (e) { best = null; }
      }
      if (!best || record.length > best.length) {
        window.localStorage.setItem("slither_best_game", JSON.stringify(record));
      }
    }
  } catch (e) {}
  updateMenuStatsDisplay();
}

function updateMenuStatsDisplay() {
  const { last, best } = loadLocalStats();
  const lastLengthEl = document.getElementById("lastLength");
  const lastBoopsEl = document.getElementById("lastBoops");
  const lastWhenEl = document.getElementById("lastWhen");
  const bestLengthEl = document.getElementById("bestLength");
  const bestBoopsEl = document.getElementById("bestBoops");
  const bestWhenEl = document.getElementById("bestWhen");

  if (last) {
    if (lastLengthEl) lastLengthEl.textContent = last.length;
    if (lastBoopsEl) lastBoopsEl.textContent = last.boops;
    if (lastWhenEl) lastWhenEl.textContent = formatTimestamp(last.when);
  }
  if (best) {
    if (bestLengthEl) bestLengthEl.textContent = best.length;
    if (bestBoopsEl) bestBoopsEl.textContent = best.boops;
    if (bestWhenEl) bestWhenEl.textContent = formatTimestamp(best.when);
  }
}

const menuEl = () => document.getElementById("menu");
const gameUIEl = () => document.getElementById("gameUI");
const deathScreenEl = () => document.getElementById("deathScreen");
const topLeaderboardEl = () => document.getElementById("topLeaderboardOverlay");

function setupMenuUI() {
  const nameInput = document.getElementById("nameInput");
  const playBtn = document.getElementById("playBtn");
  const modePvA = document.getElementById("modePvA");
  const modeOnline = document.getElementById("modeOnline");
  const modeTop = document.getElementById("modeTopLeaderboard");
  const closeTopBtn = document.getElementById("closeTopLeaderboard");

  try {
    if (modePvA && modeOnline) {
      modePvA.addEventListener("click", () => {
        modePvA.classList.add("active");
        modeOnline.classList.remove("active");
      });
    }
  } catch (err) {
    console.error("Failed to bind mode buttons:", err);
  }

  try {
    if (modeTop) {
      modeTop.addEventListener("click", () => {
        refreshTopLeaderboard();
        topLeaderboardEl().classList.remove("hidden");
      });
    }
    if (closeTopBtn) {
      closeTopBtn.addEventListener("click", () => {
        topLeaderboardEl().classList.add("hidden");
      });
    }
  } catch (err) {
    console.error("Failed to bind top leaderboard button:", err);
  }

  try {
    const diffBtns = document.querySelectorAll(".diff-btn");
    diffBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        diffBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentDifficulty = btn.dataset.difficulty;
      });
    });
  } catch (err) {
    console.error("Failed to bind difficulty buttons:", err);
  }

  try {
    const qualityBtns = document.querySelectorAll(".quality-btn");
    qualityBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        qualityBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        graphicsQuality = btn.dataset.quality;
      });
    });
  } catch (err) {
    console.error("Failed to bind quality buttons:", err);
  }

  try {
    if (playBtn && nameInput) {
      playBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        playerName = name.slice(0, 16);
        startGame();
      });
    } else {
      console.error("Play button or name input not found in DOM.");
    }
  } catch (err) {
    console.error("Failed to bind Play button:", err);
  }

  try {
    if (nameInput && playBtn) {
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") playBtn.click();
      });
    }
  } catch (err) {
    console.error("Failed to bind Enter-key shortcut:", err);
  }

  updateMenuStatsDisplay();
}

function computeLiveRank() {
  const all = [player, ...aiSnakes].filter(s => s && s.alive);
  const sorted = all.slice().sort((a, b) => b.length - a.length);
  const rank = sorted.indexOf(player) + 1;
  return { rank: rank > 0 ? rank : all.length, total: all.length };
}

function updateHUD() {
  const { rank, total } = computeLiveRank();
  document.getElementById("rankLengthVal").textContent = player.length;
  document.getElementById("rankPositionVal").textContent = `${rank} of ${total}`;
}

function drawGrid() {
  const patternSize = 340;
  const startX = Math.floor((camera.x - (W / camera.zoom) / 2 - patternSize) / patternSize) * patternSize;
  const endX = camera.x + (W / camera.zoom) / 2 + patternSize;
  const startY = Math.floor((camera.y - (H / camera.zoom) / 2 - patternSize) / patternSize) * patternSize;
  const endY = camera.y + (H / camera.zoom) / 2 + patternSize;

  for (let px = startX; px <= endX; px += patternSize) {
    for (let py = startY; py <= endY; py += patternSize) {
      drawHexCluster(px, py);
    }
  }

  const center = worldToScreen(0, 0);
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldRadius * camera.zoom, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,60,60,0.7)";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(center.x, center.y, worldRadius * camera.zoom, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  ctx.fillStyle = "rgba(120,10,10,0.35)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawHexCluster(originX, originY) {
  const hexSize = 34;
  const hexW = hexSize * 2;
  const hexH = Math.sqrt(3) * hexSize;
  const colStep = hexW * 0.75;
  const cols = 5;
  const rows = 4;

  for (let col = 0; col < cols; col++) {
    const x = originX + col * colStep;
    const yOffset = (col % 2 !== 0) ? hexH / 2 : 0;
    for (let row = 0; row < rows; row++) {
      const y = originY + row * hexH + yOffset;
      drawHexCell(x, y, hexSize);
    }
  }
}

function drawHexCell(cx, cy, size) {
  const p = worldToScreen(cx, cy);
  const s = size * camera.zoom;
  if (p.x < -s * 2 || p.x > W + s * 2 || p.y < -s * 2 || p.y > H + s * 2) return;

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    const vx = p.x + s * Math.cos(angle);
    const vy = p.y + s * Math.sin(angle);
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fillStyle = "#161b26";
  ctx.fill();
  ctx.strokeStyle = "#0c0f16";
  ctx.lineWidth = Math.max(1, 2 * camera.zoom);
  ctx.stroke();
}

function drawFood() {
  const highQuality = graphicsQuality === "high";
  for (let f of foods) {
    const p = worldToScreen(f.x, f.y);
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;

    f.pulse += 0.03;
    const wobble = highQuality ? Math.sin(f.pulse) * 0.5 : 0;
    const r = (f.radius + wobble) * camera.zoom;

    if (highQuality) {
      const glowMult = 1.6 + (f.value / FOOD_MAX_VALUE) * 2.2;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * glowMult);
      grad.addColorStop(0, f.color);
      grad.addColorStop(0.4, f.color + "55");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * glowMult, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (highQuality) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSnake(snake) {
  if (!snake.alive) return;
  const highQuality = graphicsQuality === "high";
  const r = snake.headRadius * (snake.displaySegmentCount / Math.max(1, snake.segmentCount)) * camera.zoom;
  const segs = snake.segments;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = snake.color2;
  ctx.lineWidth = r * 2;
  ctx.beginPath();
  for (let i = segs.length - 1; i >= 0; i--) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    if (i === segs.length - 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.strokeStyle = snake.color1;
  ctx.lineWidth = r * 1.6;
  ctx.beginPath();
  for (let i = segs.length - 1; i >= 0; i--) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    if (i === segs.length - 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  const ribStep = highQuality ? 3 : 6;
  for (let i = 2; i < segs.length; i += ribStep) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    const pPrev = worldToScreen(segs[i - 1].x, segs[i - 1].y);
    const segAngle = Math.atan2(p.y - pPrev.y, p.x - pPrev.x) + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(segAngle) * r * 0.85, p.y - Math.sin(segAngle) * r * 0.85);
    ctx.lineTo(p.x + Math.cos(segAngle) * r * 0.85, p.y + Math.sin(segAngle) * r * 0.85);
    ctx.stroke();
  }

  const head = worldToScreen(segs[0].x, segs[0].y);

  if (highQuality && !snake.isPlayer && snake.huntTargetIsPlayer) {
    const glow = ctx.createRadialGradient(head.x, head.y, r * 0.5, head.x, head.y, r * 2.2);
    glow.addColorStop(0, "rgba(255,60,60,0.35)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head.x, head.y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = snake.color1;
  ctx.beginPath();
  ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
  ctx.fill();

  const eyeOffset = r * 0.55;
  const eyeAngle1 = snake.angle - 0.6;
  const eyeAngle2 = snake.angle + 0.6;
  const blink = Math.abs(Math.sin(snake.eyeBlink * 0.3)) > 0.02 ? 1 : 0.15;

  for (const ea of [eyeAngle1, eyeAngle2]) {
    const ex = head.x + Math.cos(ea) * eyeOffset;
    const ey = head.y + Math.sin(ea) * eyeOffset;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.32, r * 0.32 * blink, 0, 0, Math.PI * 2);
    ctx.fill();

    const px = ex + Math.cos(snake.angle) * r * 0.1;
    const py = ey + Math.sin(snake.angle) * r * 0.1;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(px, py, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  if (snake.name) {
    ctx.font = "13px Segoe UI";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(snake.name, head.x, head.y + r + 16);
  }
}

function drawMinimap() {
  const size = minimapCanvas.width;
  minimapCtx.clearRect(0, 0, size, size);

  minimapCtx.fillStyle = "rgba(20,24,34,0.7)";
  minimapCtx.beginPath();
  minimapCtx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.strokeStyle = "rgba(255,90,90,0.5)";
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();

  if (!player || !player.alive) return;

  const viewRadius = worldRadius * 0.35;
  const scale = (size / 2) / viewRadius;
  const px = player.segments[0].x;
  const py = player.segments[0].y;

  const toMini = (x, y) => ({
    x: size / 2 + (x - px) * scale,
    y: size / 2 + (y - py) * scale
  });

  minimapCtx.save();
  minimapCtx.beginPath();
  minimapCtx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  minimapCtx.clip();

  for (let s of aiSnakes) {
    if (!s.alive) continue;
    const segs = s.segments;
    if (segs.length < 2) continue;
    minimapCtx.strokeStyle = s.color1;
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    for (let i = 0; i < segs.length; i += 3) {
      const p = toMini(segs[i].x, segs[i].y);
      if (i === 0) minimapCtx.moveTo(p.x, p.y);
      else minimapCtx.lineTo(p.x, p.y);
    }
    minimapCtx.stroke();
  }

  minimapCtx.restore();

  const centerP = toMini(px, py);
  minimapCtx.fillStyle = "#fff";
  minimapCtx.beginPath();
  minimapCtx.arc(centerP.x, centerP.y, 4, 0, Math.PI * 2);
  minimapCtx.fill();
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#12161f";
  ctx.fillRect(0, 0, W, H);

  drawGrid();
  drawFood();

  for (let s of aiSnakes) drawSnake(s);
  if (player) drawSnake(player);

  drawMinimap();
}

function updatePlayerInput() {
  if (!player || !player.alive) return;
  const dx = input.mouseX - W / 2;
  const dy = input.mouseY - H / 2;
  if (Math.hypot(dx, dy) > 4) {
    player.targetAngle = Math.atan2(dy, dx);
  }
  player.boosting = input.boosting;
}

function gameStep(dt) {
  updatePlayerInput();

  if (player && player.alive) player.move(dt);

  const allSnakesForPerception = [player, ...aiSnakes].filter(s => s && s.alive);
  rebuildSpatialGrids(allSnakesForPerception);

  const px = player ? player.segments[0].x : 0;
  const py = player ? player.segments[0].y : 0;
  const lodRadius = Math.max(W, H) / Math.max(0.2, camera.zoom) * 1.6;
  const lodRadiusSq = lodRadius * lodRadius;

  for (let ai of aiSnakes) {
    if (!ai.alive) continue;
    const head = ai.segments[0];
    const dx = head.x - px, dy = head.y - py;
    const farAway = (dx * dx + dy * dy) > lodRadiusSq;

    if (farAway) {
      ai.lodSkipCounter = (ai.lodSkipCounter + 1) % 3;
      if (ai.lodSkipCounter !== 0) continue;
      ai.think(allSnakesForPerception, dt);
      ai.move(dt * 3);
    } else {
      ai.think(allSnakesForPerception, dt);
      ai.move(dt);
    }
  }

  updateWorldRadius();
  updateFoodWobble(dt);
  checkCollisions();
  updateLiveLeaderboard(dt);

  if (player && player.alive) updateCamera(player);
}

function loop(timestamp) {
  if (!gameRunning) return;

  const dt = lastTime ? (timestamp - lastTime) : 16.67;
  lastTime = timestamp;

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 500) {
    fps = Math.round((fpsFrames * 1000) / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  gameStep(dt);
  render();
  updateHUD();

  requestAnimationFrame(loop);
}

function onPlayerDeath() {
  gameRunning = false;
  const finalLength = player.length;
  const finalBoops = player.boops;
  saveLocalStats(finalLength, finalBoops);
  syncLiveStats(playerName, finalLength, finalBoops).then(() => {
    refreshLeaderboard();
  });
  gameUIEl().classList.add("hidden");
  deathScreenEl().classList.add("hidden");
  menuEl().classList.remove("hidden");
  updateMenuStatsDisplay();
}

function startGame() {
  try {
    menuEl().classList.add("hidden");
    gameUIEl().classList.remove("hidden");
    deathScreenEl().classList.add("hidden");

    canvas.width = W;
    canvas.height = H;

    aiSnakes = [];
    updateWorldRadius();

    const spawn = { x: 0, y: 0 };
    const colorPair = SNAKE_COLORS[(Math.random() * SNAKE_COLORS.length) | 0];
    player = new Snake(spawn.x, spawn.y, playerName, colorPair, true);

    foods = [];
    initAISnakes();
    updateWorldRadius();
    fillFoodToTarget();

    camera.x = spawn.x;
    camera.y = spawn.y;
    camera.zoom = zoomForLength(player.length);

    lastTime = 0;
    gameRunning = true;
    incrementGamesCount();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error("startGame failed:", err);
    alert("Something went wrong starting the game. Check the browser console for details.");
    menuEl().classList.remove("hidden");
    gameUIEl().classList.add("hidden");
  }
}

function init() {
  try {
    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");
    minimapCanvas = document.getElementById("minimap");
    minimapCtx = minimapCanvas.getContext("2d");
    minimapCanvas.width = 130;
    minimapCanvas.height = 130;

    canvas.width = W;
    canvas.height = H;

    setupInput();
    setupMenuUI();
    startLeaderboardPolling();
    ensureUniqueUuid();

    console.log("Game initialized successfully.");
  } catch (err) {
    console.error("init() failed:", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
