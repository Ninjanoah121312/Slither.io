"use strict";

/* =========================================================================
   SECTION: GLOBAL SAFETY NET
   If ANY uncaught error happens anywhere in this file (including during
   script parse/execution before our own try/catches even exist), show it
   directly on the page. This turns "nothing happens when I click" into a
   visible, actionable message instead of a silent dead page.
   ========================================================================= */
(function setupGlobalErrorNet() {
  function showFatalError(message) {
    try {
      let box = document.getElementById("__fatalErrorBox");
      if (!box) {
        box = document.createElement("div");
        box.id = "__fatalErrorBox";
        box.style.cssText = [
          "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
          "background:#4a0d0d", "color:#ffdada", "font-family:monospace",
          "font-size:13px", "padding:12px 16px", "border-bottom:2px solid #ff6b6b",
          "white-space:pre-wrap", "max-height:40vh", "overflow:auto"
        ].join(";");
        document.body.appendChild(box);
      }
      box.textContent = "Game error (check browser console for full details):\n" + message;
    } catch (e) {
      // If even this fails, there is nothing more we can do client-side.
    }
  }
  window.addEventListener("error", (e) => {
    showFatalError((e.message || "Unknown error") + (e.filename ? ("\n" + e.filename + ":" + e.lineno) : ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    showFatalError("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
})();

/* =========================================================================
   SECTION: SUPABASE
   Since the Supabase CDN script now loads with `async`, we can't assume it
   has finished loading by the time this file runs. The client is created
   lazily on first actual use (save/fetch), and re-checked every time, so it
   works whenever the CDN script happens to finish — and never blocks or
   breaks the rest of the game if it's slow, blocked, or fails entirely.

   IMPORTANT: our own variable must NOT be named "supabase" — the Supabase
   CDN script itself declares a top-level global called "supabase", and
   having a `let`/`const supabase` here collides with it, causing:
   "Uncaught SyntaxError: Identifier 'supabase' has already been declared".
   We name ours "supabaseClient" instead to avoid any possibility of that.
   ========================================================================= */
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

async function saveScore(name, score, boops) {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("Supabase unavailable; score was not saved online.");
    return;
  }
  try {
    // NOTE: Supabase JS v2 does NOT throw for most failures (including RLS
    // policy rejections) — it resolves normally and returns { error }
    // instead. Awaiting without checking `error` is why a save could fail
    // completely silently with no console output at all.
    const { error } = await client.from("Data").insert({
      name: name,
      score: Math.round(score),
      boops: Math.round(boops),
      score_time: new Date().toISOString()
    });
    if (error) {
      console.error(
        "Supabase insert failed:", error.message || error,
        "\nMost common cause: Row Level Security (RLS) on the 'Data' table " +
        "is blocking anonymous INSERT. In the Supabase dashboard, check " +
        "Authentication > Policies for the Data table and ensure there is " +
        "a policy allowing INSERT for the 'anon' role."
      );
    } else {
      console.log("Score saved to Supabase successfully.");
    }
  } catch (err) {
    console.error("Failed to save score (network/client exception):", err);
  }
}

async function fetchLeaderboard() {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("Data")
      .select("*")
      .order("score", { ascending: false })
      .limit(10);
    if (error) {
      console.error(
        "Leaderboard fetch failed:", error.message || error,
        "\nMost common cause: Row Level Security (RLS) on the 'Data' table " +
        "is blocking anonymous SELECT. Check Authentication > Policies in " +
        "the Supabase dashboard for a policy allowing SELECT for 'anon'."
      );
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("Leaderboard fetch exception:", err);
    return [];
  }
}

/* =========================================================================
   SECTION: CONSTANTS
   ========================================================================= */
const WORLD_SIZE = 6000;          // world is WORLD_SIZE x WORLD_SIZE
const GRID_SPACING = 50;

const FOOD_COUNT_TARGET = 900;
const FOOD_MIN_RADIUS = 4;
const FOOD_MAX_RADIUS = 8;

const AI_COUNT = 12;

// Speeds are in pixels PER SECOND (not per frame) so movement is
// framerate-independent via delta time. At 60fps these match the original
// feel (2.6px/frame * 60 = 156, 4.8px/frame * 60 = 288).
const BASE_SPEED = 156;
const BOOST_SPEED = 288;
const TURN_RATE = 5.4;            // max radians PER SECOND the head can turn (0.09 * 60)
const BASE_SEGMENT_SPACING = 6.5;
const BASE_HEAD_RADIUS = 10;

const START_LENGTH = 12;          // number of segments at start
const GROWTH_PER_FOOD = 2;        // segments gained per food eaten (this IS length growth)
const SCORE_PER_FOOD = 10;        // points gained per food eaten (score is independent of length)
const SCORE_PER_KILL = 50;        // bonus points awarded to whoever kills another snake
const BOOPS_PER_KILL = 1;         // boops awarded to the killer per kill (separate from food boops)

const MAX_THICKNESS_LENGTH = 900; // length at which thickness caps out
const MIN_RADIUS_MULT = 1.0;
const MAX_RADIUS_MULT = 2.6;

const BOOST_LENGTH_COST = 3.6;    // length lost per second while boosting (0.06 * 60)
const MIN_BOOST_LENGTH = 16;

const CAMERA_LERP = 0.08;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.15;

const COLLISION_CHECK_STEP = 1;   // check every body segment (needed for reliable hit detection)
const SELF_COLLISION_BUFFER = 90; // ignore own segments closer than this real distance behind the head,
                                   // so normal tight turns never self-kill you

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

const AI_NAMES = [
  "Wriggler", "Noodle", "Fang", "Slick", "Viper", "Twister",
  "Zoomie", "Chomper", "Gobbler", "Coil", "Dash", "Squiggle",
  "Muncher", "Serpi", "Blip", "Nibbler"
];

// Difficulty presets control how aggressive/skilled AI snakes are.
const DIFFICULTY_PRESETS = {
  easy: {
    aiCount: 9,
    huntChance: 0.05,       // chance per think-tick an AI actively hunts the player
    huntRange: 260,         // distance at which an AI can notice the player to hunt
    boostChanceSeek: 0.006,
    boostChanceHunt: 0.01,
    reactionSlack: 0.35,    // higher = slower/sloppier turning toward targets
    aggressionSpeedMult: 0.95,
    avoidSkill: 0.7         // how good they are at avoiding death (0-1)
  },
  medium: {
    aiCount: 12,
    huntChance: 0.12,
    huntRange: 380,
    boostChanceSeek: 0.01,
    boostChanceHunt: 0.02,
    reactionSlack: 0.15,
    aggressionSpeedMult: 1.0,
    avoidSkill: 0.85
  },
  hard: {
    aiCount: 16,
    huntChance: 0.28,
    huntRange: 560,
    boostChanceSeek: 0.016,
    boostChanceHunt: 0.045,
    reactionSlack: 0.0,
    aggressionSpeedMult: 1.08,
    avoidSkill: 1.0
  }
};

let currentDifficulty = "medium";
function getDifficulty() {
  return DIFFICULTY_PRESETS[currentDifficulty] || DIFFICULTY_PRESETS.medium;
}

/* =========================================================================
   SECTION: GLOBAL STATE
   ========================================================================= */
let canvas, ctx, minimapCanvas, minimapCtx;
let W = window.innerWidth, H = window.innerHeight;

let gameRunning = false;
let playerName = "";

let player = null;
let aiSnakes = [];
let foods = [];
let particles = [];

let camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };

let lastTime = 0;
let fps = 0;
let fpsAccum = 0;
let fpsFrames = 0;

let spatialGrid = null; // simple spatial hash for food + collision optimization

/* =========================================================================
   SECTION: ASSETS (procedural, no external images)
   ========================================================================= */
function makeVignette() {
  // Nothing to preload; all rendering is procedural canvas drawing.
  return null;
}

/* =========================================================================
   SECTION: INPUT
   ========================================================================= */
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

/* =========================================================================
   SECTION: CAMERA
   ========================================================================= */
function updateCamera(target) {
  if (!target) return;
  const desiredX = target.segments[0].x;
  const desiredY = target.segments[0].y;
  camera.x += (desiredX - camera.x) * CAMERA_LERP;
  camera.y += (desiredY - camera.y) * CAMERA_LERP;

  // zoom out as snake grows longer
  const lengthRatio = Math.min(1, target.segments.length / 400);
  camera.targetZoom = ZOOM_MAX - lengthRatio * (ZOOM_MAX - ZOOM_MIN);
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.05;
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom + W / 2,
    y: (y - camera.y) * camera.zoom + H / 2
  };
}

/* =========================================================================
   SECTION: FOOD
   ========================================================================= */
function randomFoodColor() {
  const colors = ["#ffd166", "#4fd6ff", "#ff6bd5", "#7cf29a", "#ff9f4f", "#5cf2e0"];
  return colors[(Math.random() * colors.length) | 0];
}

function spawnFood(x, y, radius, color, value) {
  foods.push({
    x, y,
    radius: radius || (FOOD_MIN_RADIUS + Math.random() * (FOOD_MAX_RADIUS - FOOD_MIN_RADIUS)),
    color: color || randomFoodColor(),
    value: value || 1,
    pulse: Math.random() * Math.PI * 2
  });
}

function fillFoodToTarget() {
  while (foods.length < FOOD_COUNT_TARGET) {
    spawnFood(
      (Math.random() - 0.5) * WORLD_SIZE,
      (Math.random() - 0.5) * WORLD_SIZE
    );
  }
}

function dropFoodAlongPath(snake) {
  // Drop food along the snake's exact death path
  const segs = snake.segments;
  const step = Math.max(1, Math.floor(segs.length / 40)); // cap number of drops
  const valuePerDrop = Math.max(1, snake.score / Math.max(1, Math.floor(segs.length / step)));
  for (let i = 0; i < segs.length; i += step) {
    spawnFood(
      segs[i].x + (Math.random() - 0.5) * 10,
      segs[i].y + (Math.random() - 0.5) * 10,
      FOOD_MAX_RADIUS + Math.random() * 3,
      snake.color1,
      valuePerDrop
    );
  }
}

/* =========================================================================
   SECTION: SNAKE CLASS (shared base for Player and AI)
   ========================================================================= */
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
    this.score = 0;
    this.boops = 0;

    // this.path: raw high-resolution history of every point the head has
    // visited (much denser than the visible body). this.segments: the
    // visible/collidable body, derived from this.path at fixed spacing —
    // see rebuildSegmentsFromPath(). this.segmentCount is the "true" body
    // length in segments; this.segments.length always matches it.
    this.segmentCount = START_LENGTH;
    this.path = [];
    const pathPoints = START_LENGTH * 6; // dense enough to derive segments smoothly
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
  }

  get headRadius() {
    const t = Math.min(1, this.segmentCount / MAX_THICKNESS_LENGTH);
    const mult = MIN_RADIUS_MULT + t * (MAX_RADIUS_MULT - MIN_RADIUS_MULT);
    return BASE_HEAD_RADIUS * mult;
  }

  get segmentSpacing() {
    return BASE_SEGMENT_SPACING * (this.headRadius / BASE_HEAD_RADIUS) * 0.9;
  }

  // Turn head angle smoothly toward targetAngle, respecting TURN_RATE (radians/sec)
  applyTurn(dtSeconds) {
    let diff = this.targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dtSeconds;
    if (diff > maxTurn) diff = maxTurn;
    if (diff < -maxTurn) diff = -maxTurn;
    this.angle += diff;
  }

  // dt is elapsed time in milliseconds since the last frame. All motion is
  // computed from real elapsed time so the game runs at the same speed on
  // any framerate/monitor refresh rate instead of being tied to frame count.
  //
  // Implementation note: we keep a raw high-resolution path (this.path) of
  // every point the head has visited, then derive the visible/collidable
  // body segments from that path at fixed arc-length spacing. This keeps
  // segment spacing constant regardless of how far the head moves per frame.
  move(dt) {
    const dtSeconds = Math.min(dt, 100) / 1000; // clamp to avoid huge jumps after tab-switch lag

    this.applyTurn(dtSeconds);

    const canBoost = this.segmentCount > MIN_BOOST_LENGTH;
    const boosting = this.boosting && canBoost;
    const speedMult = this.isPlayer ? 1 : getDifficulty().aggressionSpeedMult;
    this.speed = (boosting ? BOOST_SPEED : BASE_SPEED) * speedMult;

    const head = this.path[0];
    const moveDist = this.speed * dtSeconds;
    const nx = head.x + Math.cos(this.angle) * moveDist;
    const ny = head.y + Math.sin(this.angle) * moveDist;

    // clamp to world bounds (soft wall - bounce angle)
    const half = WORLD_SIZE / 2;
    if (nx < -half || nx > half) { this.targetAngle = Math.PI - this.angle; }
    if (ny < -half || ny > half) { this.targetAngle = -this.angle; }
    const clampedX = Math.max(-half, Math.min(half, nx));
    const clampedY = Math.max(-half, Math.min(half, ny));

    this.path.unshift({ x: clampedX, y: clampedY });

    // growth: more segments = longer body
    if (this.growthRemaining > 0) {
      this.segmentCount += 1;
      this.growthRemaining -= 1;
    }

    // boosting shrinks the snake slowly (classic slither mechanic), scaled by real time
    if (boosting && this.segmentCount > MIN_BOOST_LENGTH) {
      this._boostAccum = (this._boostAccum || 0) + BOOST_LENGTH_COST * dtSeconds;
      if (this._boostAccum >= 1) {
        const dropCount = Math.floor(this._boostAccum);
        this._boostAccum -= dropCount;
        this.segmentCount = Math.max(MIN_BOOST_LENGTH, this.segmentCount - dropCount);
      }
    }

    // trim raw path history to what's actually needed for current body length
    const maxPathLen = Math.ceil(this.segmentCount * this.segmentSpacing) + 40;
    if (this.path.length > maxPathLen) this.path.length = maxPathLen;

    // derive evenly-spaced body segments from the raw path by arc length
    this.rebuildSegmentsFromPath();

    // drop a bit of food behind the tail while boosting (visual/gameplay feedback)
    if (boosting && this.segmentCount > MIN_BOOST_LENGTH && Math.random() < dtSeconds * 6) {
      const tail = this.segments[this.segments.length - 1];
      if (tail) spawnFood(tail.x, tail.y, FOOD_MIN_RADIUS + 1, this.color1, 1);
    }

    this.eyeBlink += dtSeconds * 5;
  }

  // Walk the raw path and place body segments at fixed arc-length intervals,
  // starting from the head. This is what gets rendered and used for
  // collision, and its point count always matches this.segmentCount.
  rebuildSegmentsFromPath() {
    const spacing = this.segmentSpacing;
    const path = this.path;
    const result = [path[0]];
    let prev = path[0];
    let accum = 0;
    let idx = 1;

    while (result.length < this.segmentCount) {
      if (idx >= path.length) {
        // ran out of recorded path (can happen briefly right after spawn or
        // a big growth spike) — pad with the last known point rather than crash
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

  grow(amount) {
    this.growthRemaining += amount;
  }

  // foodValue affects score only; length always grows by a fixed amount per
  // food so score and length are independent stats.
  eat(foodValue) {
    this.score += foodValue * SCORE_PER_FOOD;
    this.boops += 1;
    this.grow(GROWTH_PER_FOOD);
  }

  // Call this on whoever gets credit for a kill. Kept separate from eat()
  // since kills award a fixed bonus regardless of the victim's size.
  registerKill() {
    this.score += SCORE_PER_KILL;
    this.boops += BOOPS_PER_KILL;
  }

  get length() {
    return this.segmentCount;
  }
}

/* =========================================================================
   SECTION: AI SNAKE CLASS
   ========================================================================= */
class AISnake extends Snake {
  constructor(x, y, name, colorPair) {
    super(x, y, name, colorPair, false);
    this.wanderTimer = 0;
    this.wanderAngle = this.angle;
    this.state = "wander";
    this.huntCommit = 0;
    this.huntTargetIsPlayer = false;
  }

  think(allSnakes, dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const diff = getDifficulty();
    const head = this.segments[0];

    // --- find nearby food ---
    let closestFood = null;
    let closestDist = Infinity;
    const searchRadius = 400;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      const dx = f.x - head.x, dy = f.y - head.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < searchRadius * searchRadius && d2 < closestDist) {
        closestDist = d2;
        closestFood = f;
      }
    }

    // --- danger avoidance: look ahead for other snake bodies ---
    let avoidAngle = null;
    const lookAhead = this.headRadius * 6 + 60;
    const checkX = head.x + Math.cos(this.angle) * lookAhead;
    const checkY = head.y + Math.sin(this.angle) * lookAhead;
    const noticesDanger = Math.random() < diff.avoidSkill;

    if (noticesDanger) {
      for (let s of allSnakes) {
        if (s === this || !s.alive) continue;
        const segs = s.segments;
        for (let i = 0; i < segs.length; i += COLLISION_CHECK_STEP) {
          const seg = segs[i];
          const dx = seg.x - checkX, dy = seg.y - checkY;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 70 * 70) {
            avoidAngle = Math.atan2(head.y - seg.y, head.x - seg.x);
            break;
          }
        }
        if (avoidAngle !== null) break;
      }
    }

    // world edge avoidance
    const half = WORLD_SIZE / 2;
    const margin = 300;
    let edgeAngle = null;
    if (head.x < -half + margin || head.x > half - margin || head.y < -half + margin || head.y > half - margin) {
      edgeAngle = Math.atan2(-head.y, -head.x);
    }

    // --- hunt the player (aggression driven by difficulty) ---
    let huntAngle = null;
    if (player && player.alive) {
      const dxp = player.segments[0].x - head.x;
      const dyp = player.segments[0].y - head.y;
      const distp2 = dxp * dxp + dyp * dyp;
      const inRange = distp2 < diff.huntRange * diff.huntRange;
      const sizeOk = this.segments.length + 20 > player.segments.length * 0.5 || currentDifficulty === "hard";

      if (this.huntCommit > 0) {
        this.huntCommit -= dtSeconds;
      } else if (inRange && sizeOk && Math.random() < diff.huntChance) {
        this.huntCommit = 1.5 + Math.random() * 2; // seconds committed to the chase
      }

      if (this.huntCommit > 0 && inRange) {
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
      }
    } else {
      this.huntTargetIsPlayer = false;
      this.huntCommit = 0;
    }

    // --- decide final target angle: avoid > edge > hunt > food > wander
    let desiredAngle;
    if (avoidAngle !== null) {
      desiredAngle = avoidAngle;
      this.state = "avoid";
    } else if (edgeAngle !== null) {
      desiredAngle = edgeAngle;
      this.state = "edge";
    } else if (huntAngle !== null) {
      desiredAngle = huntAngle;
      this.state = "hunt";
    } else if (closestFood) {
      desiredAngle = Math.atan2(closestFood.y - head.y, closestFood.x - head.x);
      this.state = "seek";
    } else {
      this.wanderTimer -= dtSeconds;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = this.angle + (Math.random() - 0.5) * 1.4;
        this.wanderTimer = 0.67 + Math.random() * 1.0; // seconds until next wander direction change
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

    // boost behavior depends on state and difficulty aggression.
    // Probabilities were tuned assuming ~60 checks/sec, so scale by dt to
    // keep the actual boost frequency constant regardless of framerate.
    const frameNormalizer = dtSeconds * 60;
    if (this.segments.length > 60) {
      if (this.state === "hunt") {
        this.boosting = Math.random() < diff.boostChanceHunt * frameNormalizer;
      } else if (this.state === "seek") {
        this.boosting = Math.random() < diff.boostChanceSeek * frameNormalizer;
      } else {
        this.boosting = false;
      }
    } else {
      this.boosting = false;
    }
  }
}

/* =========================================================================
   SECTION: COLLISION
   ========================================================================= */
function distSq(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function killSnake(snake, killer) {
  snake.alive = false;
  dropFoodAlongPath(snake);

  // Award the kill to whoever caused it (if anyone did — e.g. running into
  // the world border or a bug-free edge case has no killer).
  if (killer && killer.alive && killer !== snake) {
    killer.registerKill();
  }

  if (snake.isPlayer) {
    onPlayerDeath();
  }
}

function checkCollisions() {
  const allSnakes = [player, ...aiSnakes].filter(s => s && s.alive);

  for (let snake of allSnakes) {
    if (!snake.alive) continue;
    const head = snake.segments[0];
    const headR = snake.headRadius;

    // food collisions (only for this snake's head)
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      const rr = (headR + f.radius);
      if (distSq(head.x, head.y, f.x, f.y) < rr * rr) {
        snake.eat(f.value);
        foods.splice(i, 1);
      }
    }

    // snake-vs-snake body collisions. A snake's own body is intentionally
    // NOT lethal (matches real slither.io behavior and the original spec:
    // "the player's own body should not instantly kill itself") — a long
    // snake naturally coils back near its own head during normal tight
    // turns, and treating that as death felt like dying "out of nowhere".
    for (let other of allSnakes) {
      if (!other.alive || other === snake) continue;
      const segs = other.segments;
      const otherR = other.headRadius;

      for (let i = 1; i < segs.length; i += COLLISION_CHECK_STEP) {
        const seg = segs[i];
        const rr = (headR * 0.8 + otherR * 0.8);
        if (distSq(head.x, head.y, seg.x, seg.y) < rr * rr) {
          killSnake(snake, other);
          break;
        }
      }
      if (!snake.alive) break;
    }
  }

  // remove dead AI snakes from array (after loop to avoid mutation issues)
  aiSnakes = aiSnakes.filter(s => s.alive);

  // keep spawning AI to maintain population (target count depends on difficulty)
  const targetAICount = getDifficulty().aiCount;
  while (aiSnakes.length < targetAICount) {
    spawnOneAI();
  }

  fillFoodToTarget();
}

/* =========================================================================
   SECTION: SPAWNING HELPERS
   ========================================================================= */
function randomSpawnPoint() {
  const half = WORLD_SIZE / 2 - 400;
  return {
    x: (Math.random() - 0.5) * 2 * half,
    y: (Math.random() - 0.5) * 2 * half
  };
}

function spawnOneAI() {
  const pos = randomSpawnPoint();
  const name = AI_NAMES[(Math.random() * AI_NAMES.length) | 0];
  const colorPair = SNAKE_COLORS[(Math.random() * SNAKE_COLORS.length) | 0];
  aiSnakes.push(new AISnake(pos.x, pos.y, name, colorPair));
}

function initAISnakes() {
  aiSnakes = [];
  const count = getDifficulty().aiCount;
  for (let i = 0; i < count; i++) spawnOneAI();
}

/* =========================================================================
   SECTION: LEADERBOARD
   ========================================================================= */
let leaderboardCache = [];

function renderLeaderboardList(listEl, data, highlightName) {
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
    if (highlightName && row.name === highlightName) li.classList.add("me");
    const rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = "#" + (idx + 1);
    const nameSpan = document.createElement("span");
    nameSpan.className = "lname";
    nameSpan.textContent = row.name || "???";
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "lscore";
    scoreSpan.textContent = row.score;
    li.appendChild(rankSpan);
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    listEl.appendChild(li);
  });
}

async function refreshLeaderboard() {
  const data = await fetchLeaderboard();
  leaderboardCache = data;
  const menuList = document.getElementById("menuLeaderboardList");
  const liveList = document.getElementById("liveLeaderboardList");
  if (menuList) renderLeaderboardList(menuList, data, playerName);
  if (liveList) renderLeaderboardList(liveList, data, playerName);
}

function startLeaderboardPolling() {
  refreshLeaderboard();
  setInterval(refreshLeaderboard, 10000);
}

/* =========================================================================
   SECTION: UI
   ========================================================================= */
const menuEl = () => document.getElementById("menu");
const gameUIEl = () => document.getElementById("gameUI");
const deathScreenEl = () => document.getElementById("deathScreen");

function setupMenuUI() {
  const nameInput = document.getElementById("nameInput");
  const playBtn = document.getElementById("playBtn");
  const modePvA = document.getElementById("modePvA");
  const modeOnline = document.getElementById("modeOnline");

  // Each binding is wrapped independently: if one control is missing or a
  // listener throws, it must not prevent the Play button (or anything else)
  // from being wired up.

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

  // modeOnline is disabled; clicking does nothing (Coming Soon)

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
    if (playBtn && nameInput) {
      playBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          nameInput.style.borderColor = "#ff6b6b";
          setTimeout(() => { nameInput.style.borderColor = ""; }, 900);
          return;
        }
        playerName = name.slice(0, 16);
        startGame();
      });
    } else {
      console.error("Play button or name input not found in DOM. Check element IDs 'playBtn' and 'nameInput'.");
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
}

function setupDeathUI() {
  try {
    const respawnBtn = document.getElementById("respawnBtn");
    if (respawnBtn) {
      respawnBtn.addEventListener("click", () => {
        deathScreenEl().classList.add("hidden");
        menuEl().classList.remove("hidden");
        gameUIEl().classList.add("hidden");
        gameRunning = false;
      });
    } else {
      console.error("Respawn button not found in DOM. Check element ID 'respawnBtn'.");
    }
  } catch (err) {
    console.error("Failed to bind respawn button:", err);
  }
}

function showDeathScreen() {
  const statsEl = document.getElementById("deathStats");
  statsEl.textContent = `Final Score: ${Math.round(player.score)}  •  Boops: ${player.boops}  •  Length: ${player.length}`;
  deathScreenEl().classList.remove("hidden");
}

function updateHUD() {
  document.getElementById("scoreVal").textContent = Math.round(player.score);
  document.getElementById("lengthVal").textContent = player.length;
  document.getElementById("fpsVal").textContent = fps;
  const diffEl = document.getElementById("diffVal");
  if (diffEl) diffEl.textContent = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
}

/* =========================================================================
   SECTION: RENDERING
   ========================================================================= */
function drawGrid() {
  const half = WORLD_SIZE / 2;
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;

  const startX = Math.floor((camera.x - W / camera.zoom / 2) / GRID_SPACING) * GRID_SPACING;
  const endX = camera.x + W / camera.zoom / 2;
  const startY = Math.floor((camera.y - H / camera.zoom / 2) / GRID_SPACING) * GRID_SPACING;
  const endY = camera.y + H / camera.zoom / 2;

  ctx.beginPath();
  for (let x = Math.max(startX, -half); x <= Math.min(endX, half); x += GRID_SPACING) {
    const p1 = worldToScreen(x, -half);
    const p2 = worldToScreen(x, half);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let y = Math.max(startY, -half); y <= Math.min(endY, half); y += GRID_SPACING) {
    const p1 = worldToScreen(-half, y);
    const p2 = worldToScreen(half, y);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  // world border
  const tl = worldToScreen(-half, -half);
  const br = worldToScreen(half, half);
  ctx.strokeStyle = "rgba(255,90,90,0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawFood() {
  for (let f of foods) {
    const p = worldToScreen(f.x, f.y);
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;

    f.pulse += 0.05;
    const glowR = (f.radius + Math.sin(f.pulse) * 1.2) * camera.zoom;

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR * 2.2);
    grad.addColorStop(0, f.color);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnake(snake) {
  if (!snake.alive) return;
  const r = snake.headRadius * camera.zoom;
  const segs = snake.segments;

  // body (draw from tail to head so head overlaps)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // outer glow/body stroke
  ctx.strokeStyle = snake.color2;
  ctx.lineWidth = r * 2;
  ctx.beginPath();
  for (let i = segs.length - 1; i >= 0; i--) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    if (i === segs.length - 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // inner body stroke (lighter)
  ctx.strokeStyle = snake.color1;
  ctx.lineWidth = r * 1.5;
  ctx.beginPath();
  for (let i = segs.length - 1; i >= 0; i--) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    if (i === segs.length - 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // segment pattern (subtle scale-like dots)
  for (let i = 0; i < segs.length; i += 4) {
    const p = worldToScreen(segs[i].x, segs[i].y);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // head
  const head = worldToScreen(segs[0].x, segs[0].y);

  // hunting indicator: subtle red aggression glow around a head that is
  // actively chasing the player
  if (!snake.isPlayer && snake.huntTargetIsPlayer) {
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

  // eyes
  const eyeOffset = r * 0.55;
  const eyeAngle1 = snake.angle - 0.6;
  const eyeAngle2 = snake.angle + 0.6;
  const blink = Math.abs(Math.sin(snake.eyeBlink * 0.3)) > 0.02 ? 1 : 0.15;

  for (const ea of [eyeAngle1, eyeAngle2]) {
    const ex = head.x + Math.cos(ea) * eyeOffset;
    const ey = head.y + Math.sin(ea) * eyeOffset;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.28, r * 0.28 * blink, 0, 0, Math.PI * 2);
    ctx.fill();

    const px = ex + Math.cos(snake.angle) * r * 0.1;
    const py = ey + Math.sin(snake.angle) * r * 0.1;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(px, py, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  // name label
  if (!snake.isPlayer) {
    ctx.font = "12px Segoe UI";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "center";
    ctx.fillText(snake.name, head.x, head.y - r - 10);
  }
}

function drawMinimap() {
  const size = minimapCanvas.width;
  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.fillStyle = "rgba(20,24,34,0.6)";
  minimapCtx.fillRect(0, 0, size, size);

  const scale = size / WORLD_SIZE;
  const toMini = (x, y) => ({
    x: (x + WORLD_SIZE / 2) * scale,
    y: (y + WORLD_SIZE / 2) * scale
  });

  for (let s of aiSnakes) {
    if (!s.alive) continue;
    const p = toMini(s.segments[0].x, s.segments[0].y);
    minimapCtx.fillStyle = s.color1;
    minimapCtx.beginPath();
    minimapCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  if (player && player.alive) {
    const p = toMini(player.segments[0].x, player.segments[0].y);
    minimapCtx.fillStyle = "#fff";
    minimapCtx.beginPath();
    minimapCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0e1420";
  ctx.fillRect(0, 0, W, H);

  drawGrid();
  drawFood();

  for (let s of aiSnakes) drawSnake(s);
  if (player) drawSnake(player);

  drawMinimap();
}

/* =========================================================================
   SECTION: GAME LOOP
   ========================================================================= */
function updatePlayerInput() {
  if (!player || !player.alive) return;
  // mouse position relative to screen center = desired direction
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

  for (let ai of aiSnakes) {
    if (!ai.alive) continue;
    ai.think([player, ...aiSnakes], dt);
    ai.move(dt);
  }

  checkCollisions();

  if (player && player.alive) updateCamera(player);
}

function loop(timestamp) {
  if (!gameRunning) return;

  const dt = lastTime ? (timestamp - lastTime) : 16.67;
  lastTime = timestamp;

  // FPS calc
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

/* =========================================================================
   SECTION: GAME LIFECYCLE
   ========================================================================= */
function onPlayerDeath() {
  gameRunning = false;
  saveScore(playerName, player.score, player.boops).then(() => {
    refreshLeaderboard();
  });
  showDeathScreen();
}

function startGame() {
  try {
    menuEl().classList.add("hidden");
    gameUIEl().classList.remove("hidden");
    deathScreenEl().classList.add("hidden");

    canvas.width = W;
    canvas.height = H;

    const spawn = { x: 0, y: 0 };
    const colorPair = SNAKE_COLORS[(Math.random() * SNAKE_COLORS.length) | 0];
    player = new Snake(spawn.x, spawn.y, playerName, colorPair, true);

    foods = [];
    fillFoodToTarget();

    initAISnakes();

    camera.x = spawn.x;
    camera.y = spawn.y;
    camera.zoom = ZOOM_MAX;
    camera.targetZoom = ZOOM_MAX;

    lastTime = 0;
    gameRunning = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error("startGame failed:", err);
    // Surface it instead of silently doing nothing
    alert("Something went wrong starting the game. Check the browser console for details.");
    menuEl().classList.remove("hidden");
    gameUIEl().classList.add("hidden");
  }
}

/* =========================================================================
   SECTION: INIT
   ========================================================================= */
function init() {
  try {
    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");
    minimapCanvas = document.getElementById("minimap");
    minimapCtx = minimapCanvas.getContext("2d");
    minimapCanvas.width = 140;
    minimapCanvas.height = 140;

    canvas.width = W;
    canvas.height = H;

    setupInput();
    setupMenuUI();
    setupDeathUI();
    startLeaderboardPolling();

    console.log("Game initialized successfully.");
  } catch (err) {
    console.error("init() failed:", err);
  }
}

// Because js.js is loaded at the end of <body>, the DOM is already parsed
// by the time this script runs, so "DOMContentLoaded" may have already fired
// and would never call init(). Guard against that race directly.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
