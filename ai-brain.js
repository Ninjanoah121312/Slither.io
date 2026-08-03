"use strict";

const AI_LOOKAHEAD_CANDIDATES = 6;
const AI_LOOKAHEAD_SPREAD = Math.PI * 0.78;
const AI_LOOKAHEAD_STEPS = 3;
const AI_LOOKAHEAD_STEP_TIME = 0.22;
const AI_MEMORY_DECAY = 0.92;
const AI_PACK_AWARENESS_RADIUS = 550;

const AI_PLAYER_TRACK_HISTORY_LEN = 24;
const AI_PLAYER_TRACK_SAMPLE_INTERVAL = 0.12;
const AI_ENCIRCLEMENT_SECTOR_COUNT = 8;
const AI_ENCIRCLEMENT_CHECK_RADIUS_MULT = 3.2;
const AI_ENCIRCLEMENT_ANGER_THRESHOLD = 0.55;
const AI_ANGER_DECAY = 0.85;
const AI_ANGER_GAIN_PER_HIT_ATTEMPT = 0.35;
const AI_ANGER_GAIN_PER_CLOSE_CALL = 0.12;
const AI_CORRIDOR_SAMPLE_COUNT = 5;
const AI_CORRIDOR_SAMPLE_SPREAD = Math.PI * 1.6;
const AI_TERRITORY_CELL_SIZE = 240;
const AI_TERRITORY_MEMORY_CAP = 80;
const AI_TERRITORY_DECAY = 0.985;
const AI_GROUP_SIGNAL_RADIUS = 700;
const AI_GROUP_SIGNAL_DECAY = 0.9;
const AI_PERSONALITY_DRIFT_RATE = 0.004;
const AI_KILLCHAIN_WINDOW = 2.2;
const AI_INTERCEPT_ITERATIONS = 4;
const AI_STUCK_ESCAPE_ANGLE_JITTER = 0.9;
const AI_FOOD_WAYPOINT_COUNT = 3;
const AI_MOMENTUM_TURN_PENALTY_MULT = 0.22;
const AI_HEAD_ON_DANGER_BONUS = 0.6;
const AI_SIZE_ADVANTAGE_CONFIDENCE_SCALE = 0.3;
const AI_FLEE_COMMIT_MIN = 0.8;
const AI_FLEE_COMMIT_MAX = 2.4;
const AI_BOOST_ENERGY_CAP = 6.0;
const AI_BOOST_ENERGY_REGEN = 0.9;
const AI_BOOST_ENERGY_COST = 1.0;
const AI_VISION_CONE_HALF_ANGLE = Math.PI * 0.7;
const AI_PANIC_SCORE_THRESHOLD = 2.4;
const AI_CONFIDENCE_SMOOTHING = 0.12;
const AI_LANE_DISCIPLINE_WEIGHT = 0.18;
const AI_REVENGE_MEMORY_DURATION = 8.0;

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function territoryKey(x, y) {
  const cx = Math.floor(x / AI_TERRITORY_CELL_SIZE);
  const cy = Math.floor(y / AI_TERRITORY_CELL_SIZE);
  return cx + "_" + cy;
}

const globalGroupSignals = new Map();

function emitGroupSignal(x, y, kind, strength) {
  const key = territoryKey(x, y);
  const existing = globalGroupSignals.get(key);
  const entry = existing || { danger: 0, opportunity: 0, x, y };
  if (kind === "danger") entry.danger = Math.min(4, entry.danger + strength);
  else if (kind === "opportunity") entry.opportunity = Math.min(4, entry.opportunity + strength);
  entry.x = x;
  entry.y = y;
  globalGroupSignals.set(key, entry);
  if (globalGroupSignals.size > 2000) {
    const firstKey = globalGroupSignals.keys().next().value;
    globalGroupSignals.delete(firstKey);
  }
}

function decayGroupSignals() {
  for (let [key, entry] of globalGroupSignals) {
    entry.danger *= AI_GROUP_SIGNAL_DECAY;
    entry.opportunity *= AI_GROUP_SIGNAL_DECAY;
    if (entry.danger < 0.02 && entry.opportunity < 0.02) {
      globalGroupSignals.delete(key);
    }
  }
}

let groupSignalDecayTimer = 0;
function maybeDecayGroupSignals(dtSeconds) {
  groupSignalDecayTimer += dtSeconds;
  if (groupSignalDecayTimer > 0.5) {
    groupSignalDecayTimer = 0;
    decayGroupSignals();
  }
}

function readGroupSignalNear(x, y, radius) {
  let danger = 0, opportunity = 0, dangerAngleX = 0, dangerAngleY = 0, count = 0;
  for (let [key, entry] of globalGroupSignals) {
    const dx = entry.x - x, dy = entry.y - y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > radius * radius) continue;
    const dist = Math.sqrt(dist2) || 1;
    const weight = 1 - dist / radius;
    danger += entry.danger * weight;
    opportunity += entry.opportunity * weight;
    if (entry.danger > 0.1) {
      dangerAngleX += (dx / dist) * entry.danger * weight;
      dangerAngleY += (dy / dist) * entry.danger * weight;
      count++;
    }
  }
  let dangerDirection = null;
  if (count > 0 && (dangerAngleX !== 0 || dangerAngleY !== 0)) {
    dangerDirection = Math.atan2(dangerAngleY, dangerAngleX);
  }
  return { danger, opportunity, dangerDirection };
}

class PlayerTracker {
  constructor() {
    this.history = [];
    this.sampleTimer = 0;
  }

  update(dtSeconds) {
    if (!player || !player.alive) return;
    this.sampleTimer -= dtSeconds;
    if (this.sampleTimer > 0) return;
    this.sampleTimer = AI_PLAYER_TRACK_SAMPLE_INTERVAL;
    const head = player.segments[0];
    this.history.push({ x: head.x, y: head.y, angle: player.angle, t: performance.now() });
    if (this.history.length > AI_PLAYER_TRACK_HISTORY_LEN) {
      this.history.shift();
    }
  }

  getVelocityEstimate() {
    if (this.history.length < 2) return { vx: 0, vy: 0 };
    const a = this.history[this.history.length - 2];
    const b = this.history[this.history.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  predictFuturePosition(seconds) {
    if (this.history.length === 0) return null;
    const latest = this.history[this.history.length - 1];
    const vel = this.getVelocityEstimate();
    return { x: latest.x + vel.vx * seconds, y: latest.y + vel.vy * seconds };
  }

  getRecentHeadings() {
    if (this.history.length < 2) return [];
    const headings = [];
    for (let i = 1; i < this.history.length; i++) {
      const a = this.history[i - 1], b = this.history[i];
      headings.push(Math.atan2(b.y - a.y, b.x - a.x));
    }
    return headings;
  }
}

const globalPlayerTracker = new PlayerTracker();

class AISnake extends Snake {
  constructor(x, y, name, colorPair, initialLength) {
    super(x, y, name, colorPair, false, initialLength);
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
    this.dangerMemory = new Map();
    this.personalityAggression = 0.4 + Math.random() * 0.6;
    this.personalityCaution = 0.3 + Math.random() * 0.7;
    this.personalityPatience = 0.2 + Math.random() * 0.8;
    this.personalityPackAffinity = Math.random();
    this.lastGoodAngle = this.angle;
    this.stuckTimer = 0;
    this.lastPos = { x, y };
    this.trapAssessTimer = 0;

    this.angerLevel = 0;
    this.encirclementScore = 0;
    this.encirclementDirection = null;
    this.playerIsAngerTarget = false;
    this.revengeMemory = new Map();
    this.territoryVisits = new Map();
    this.groupSignalTimer = 0;
    this.confidence = 0.5;
    this.boostEnergy = AI_BOOST_ENERGY_CAP;
    this.foodWaypoints = [];
    this.killChainTimer = 0;
    this.killChainCount = 0;
    this.lastThinkAngleChoice = this.angle;
    this.panicMode = false;
    this.panicTimer = 0;
    this.lastKnownPlayerSector = -1;
    this.identityMomentum = { x: Math.cos(this.angle), y: Math.sin(this.angle) };
    this.frameCounter = 0;
    this.fsmState = "spawn";
    this.fsmTimer = 0;
    this._cachedTier = null;
    this.tierSpeedConfidence = 0.8;
    this.tierRiskTolerance = 0.5;
    this.tierPreferredPackDistance = 400;
    this._scentTrail = [];
  }

  updatePersonalityDrift(dtSeconds) {
    const driftAgg = (Math.random() - 0.5) * AI_PERSONALITY_DRIFT_RATE;
    const driftCau = (Math.random() - 0.5) * AI_PERSONALITY_DRIFT_RATE;
    this.personalityAggression = Math.min(1, Math.max(0.05, this.personalityAggression + driftAgg));
    this.personalityCaution = Math.min(1, Math.max(0.05, this.personalityCaution + driftCau));
  }

  recordTerritoryVisit(x, y) {
    const key = territoryKey(x, y);
    const current = this.territoryVisits.get(key) || 0;
    this.territoryVisits.set(key, Math.min(5, current + 0.5));
    if (this.territoryVisits.size > AI_TERRITORY_MEMORY_CAP) {
      const firstKey = this.territoryVisits.keys().next().value;
      this.territoryVisits.delete(firstKey);
    }
  }

  decayTerritoryMemory() {
    for (let [key, val] of this.territoryVisits) {
      const decayed = val * AI_TERRITORY_DECAY;
      if (decayed < 0.05) this.territoryVisits.delete(key);
      else this.territoryVisits.set(key, decayed);
    }
  }

  getTerritoryFamiliarity(x, y) {
    const key = territoryKey(x, y);
    return this.territoryVisits.get(key) || 0;
  }

  gatherThreats(checkX, checkY, radius) {
    const threats = [];
    const seen = new Set();
    forEachNearbySegment(checkX, checkY, radius, (entry) => {
      if (!entry.snake.alive) return false;
      if (entry.snake === this && entry.index < 8) return false;
      const seg = entry.seg;
      const dx = seg.x - checkX, dy = seg.y - checkY;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > radius * radius) return false;
      if (!seen.has(entry.snake)) {
        seen.add(entry.snake);
        threats.push({ snake: entry.snake, seg, dist2, isSelf: entry.snake === this });
      } else {
        for (let t of threats) {
          if (t.snake === entry.snake && dist2 < t.dist2) {
            t.seg = seg;
            t.dist2 = dist2;
          }
        }
      }
      return false;
    });
    return threats;
  }

  computeEncirclementScore(head, threatsUnused) {
    const sectorHits = new Array(AI_ENCIRCLEMENT_SECTOR_COUNT).fill(0);
    const sectorIsPlayer = new Array(AI_ENCIRCLEMENT_SECTOR_COUNT).fill(false);
    const checkRadius = this.headRadius * AI_ENCIRCLEMENT_CHECK_RADIUS_MULT + 200;
    let anyFound = false;

    forEachNearbySegment(head.x, head.y, checkRadius, (entry) => {
      if (entry.snake === this && entry.index < 8) return false;
      if (!entry.snake.alive) return false;
      const seg = entry.seg;
      const dx = seg.x - head.x, dy = seg.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > checkRadius) return false;

      const angleToThreat = Math.atan2(dy, dx);
      let sector = Math.floor(((angleToThreat + Math.PI) / (Math.PI * 2)) * AI_ENCIRCLEMENT_SECTOR_COUNT);
      sector = ((sector % AI_ENCIRCLEMENT_SECTOR_COUNT) + AI_ENCIRCLEMENT_SECTOR_COUNT) % AI_ENCIRCLEMENT_SECTOR_COUNT;
      const proximityWeight = 1 - Math.min(1, dist / checkRadius);
      if (proximityWeight > sectorHits[sector]) {
        sectorHits[sector] = proximityWeight;
        if (entry.snake === player) sectorIsPlayer[sector] = true;
      }
      anyFound = true;
      return false;
    });

    if (!anyFound) return { score: 0, openSectorAngle: null, playerSectorCount: 0 };

    let filledSectors = 0;
    let totalFill = 0;
    let playerSectorCount = 0;
    for (let i = 0; i < sectorHits.length; i++) {
      if (sectorHits[i] > 0.15) {
        filledSectors++;
        if (sectorIsPlayer[i]) playerSectorCount++;
      }
      totalFill += sectorHits[i];
    }

    const score = (filledSectors / AI_ENCIRCLEMENT_SECTOR_COUNT) * 0.6 + (totalFill / AI_ENCIRCLEMENT_SECTOR_COUNT) * 0.4;

    let bestSector = -1;
    let bestOpenness = Infinity;
    for (let i = 0; i < sectorHits.length; i++) {
      if (sectorHits[i] < bestOpenness) {
        bestOpenness = sectorHits[i];
        bestSector = i;
      }
    }
    const openSectorAngle = bestSector >= 0
      ? (bestSector / AI_ENCIRCLEMENT_SECTOR_COUNT) * Math.PI * 2 - Math.PI
      : null;

    return { score, openSectorAngle, playerSectorCount };
  }

  updateAngerAndEncirclement(head, threats, dtSeconds) {
    const enc = this.computeEncirclementScore(head, threats);
    this.encirclementScore = enc.score;
    this.encirclementDirection = enc.openSectorAngle;

    const playerContributesMultipleSectors = (enc.playerSectorCount || 0) >= 2;
    const playerSurrounding = playerContributesMultipleSectors && enc.score > AI_ENCIRCLEMENT_ANGER_THRESHOLD;
    this.playerIsAngerTarget = playerSurrounding;

    if (playerSurrounding) {
      this.angerLevel = Math.min(1, this.angerLevel + AI_ANGER_GAIN_PER_HIT_ATTEMPT * dtSeconds * 3);
    } else {
      let closeCall = false;
      for (let t of threats) {
        if (t.isSelf) continue;
        if (Math.sqrt(t.dist2) < this.headRadius * 2.5) { closeCall = true; break; }
      }
      if (closeCall) {
        this.angerLevel = Math.min(1, this.angerLevel + AI_ANGER_GAIN_PER_CLOSE_CALL * dtSeconds * 3);
      } else {
        this.angerLevel *= Math.pow(AI_ANGER_DECAY, dtSeconds * 3);
      }
    }
  }

  findEscapeCorridor(head, threats, dangerMargin) {
    let bestAngle = this.encirclementDirection !== null ? this.encirclementDirection : this.angle + Math.PI;
    let bestClearance = -Infinity;

    for (let i = 0; i < AI_CORRIDOR_SAMPLE_COUNT; i++) {
      const t = (i / (AI_CORRIDOR_SAMPLE_COUNT - 1)) - 0.5;
      const testAngle = (this.encirclementDirection !== null ? this.encirclementDirection : this.angle + Math.PI) + t * AI_CORRIDOR_SAMPLE_SPREAD;
      const clearance = this.simulatePathSafety(head, testAngle, this.speed || BASE_SPEED, threats, dangerMargin);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestAngle = testAngle;
      }
    }

    return bestAngle;
  }

  simulatePathSafety(head, angle, speed, threats, dangerMargin) {
    let minClearance = Infinity;
    const hasThreats = threats.length > 0;
    let finalPx = head.x, finalPy = head.y;

    for (let step = 1; step <= AI_LOOKAHEAD_STEPS; step++) {
      const dist = speed * AI_LOOKAHEAD_STEP_TIME * step;
      const px = head.x + Math.cos(angle) * dist;
      const py = head.y + Math.sin(angle) * dist;
      finalPx = px;
      finalPy = py;

      const distFromCenter = Math.hypot(px, py);
      const edgeClearance = worldRadius - distFromCenter;
      if (edgeClearance < minClearance) minClearance = edgeClearance;

      if (hasThreats) {
        for (let t of threats) {
          if (t.isSelf) continue;
          const dx = t.seg.x - px, dy = t.seg.y - py;
          const d = Math.hypot(dx, dy) - dangerMargin;
          if (d < minClearance) minClearance = d;
        }
      }
    }

    if (this.dangerMemory.size > 0) {
      const memKey = cellKey(finalPx, finalPy);
      const memPenalty = this.dangerMemory.get(memKey);
      if (memPenalty && memPenalty > 0) {
        minClearance -= memPenalty * 40;
      }
    }

    const familiarity = this.getTerritoryFamiliarity(finalPx, finalPy);
    if (familiarity > 2) {
      minClearance -= (familiarity - 2) * 8;
    }

    return minClearance;
  }

  gatherNearbyFoodForScoring(head, searchRadius) {
    const list = [];
    forEachNearbyFood(head.x, head.y, searchRadius, (f) => {
      const dx = f.x - head.x, dy = f.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > searchRadius || dist < 1) return false;
      list.push({ angle: Math.atan2(dy, dx), dist, value: f.value, x: f.x, y: f.y });
      return false;
    });
    return list;
  }

  buildFoodWaypoints(head, nearbyFoodList) {
    if (nearbyFoodList.length === 0) {
      this.foodWaypoints = [];
      return;
    }
    const sorted = nearbyFoodList.slice().sort((a, b) => {
      const scoreA = (a.value / FOOD_MAX_VALUE) * 0.4 + (1 - a.dist / 260) * 0.6;
      const scoreB = (b.value / FOOD_MAX_VALUE) * 0.4 + (1 - b.dist / 260) * 0.6;
      return scoreB - scoreA;
    });
    this.foodWaypoints = sorted.slice(0, AI_FOOD_WAYPOINT_COUNT);
  }

  scoreFoodForAngle(nearbyFoodList, angle, searchRadius) {
    let bestScore = 0;
    for (let f of nearbyFoodList) {
      let diff = angleDiff(f.angle, angle);
      const alignScore = Math.max(0, 1 - Math.abs(diff) / (Math.PI * 0.5));
      if (alignScore <= 0) continue;
      const distScore = 1 - Math.min(1, f.dist / searchRadius);
      const valueScore = f.value / FOOD_MAX_VALUE;
      const s = alignScore * (0.5 + distScore * 0.3 + valueScore * 0.2);
      if (s > bestScore) bestScore = s;
    }
    return bestScore;
  }

  computeMomentumPenalty(angle) {
    const desiredX = Math.cos(angle), desiredY = Math.sin(angle);
    const dot = this.identityMomentum.x * desiredX + this.identityMomentum.y * desiredY;
    return (1 - dot) * AI_MOMENTUM_TURN_PENALTY_MULT;
  }

  updateMomentum(dtSeconds) {
    const targetX = Math.cos(this.angle), targetY = Math.sin(this.angle);
    const blend = Math.min(1, dtSeconds * 4);
    this.identityMomentum.x += (targetX - this.identityMomentum.x) * blend;
    this.identityMomentum.y += (targetY - this.identityMomentum.y) * blend;
    const mag = Math.hypot(this.identityMomentum.x, this.identityMomentum.y) || 1;
    this.identityMomentum.x /= mag;
    this.identityMomentum.y /= mag;
  }

  chooseBestHeading(head, threats, dangerMargin, biasAngle, biasWeight, wantFood, laneBiasAngle) {
    const candidates = [];
    const baseAngle = this.angle;
    for (let i = 0; i < AI_LOOKAHEAD_CANDIDATES; i++) {
      const t = (i / (AI_LOOKAHEAD_CANDIDATES - 1)) - 0.5;
      candidates.push(baseAngle + t * AI_LOOKAHEAD_SPREAD);
    }

    const nearbyFoodList = wantFood ? this.gatherNearbyFoodForScoring(head, 260) : null;
    if (wantFood && nearbyFoodList) this.buildFoodWaypoints(head, nearbyFoodList);

    let bestAngle = baseAngle;
    let bestScore = -Infinity;

    for (let angle of candidates) {
      const safety = this.simulatePathSafety(head, angle, this.speed || BASE_SPEED, threats, dangerMargin);
      const safetyScore = Math.max(-500, safety) / 100;

      const turnPenalty = -Math.abs(angleDiff(angle, baseAngle)) * 0.15;
      const momentumPenalty = -this.computeMomentumPenalty(angle);

      let biasScore = 0;
      if (biasAngle !== null) {
        const bd = angleDiff(angle, biasAngle);
        biasScore = (1 - Math.abs(bd) / Math.PI) * biasWeight;
      }

      let laneScore = 0;
      if (laneBiasAngle !== null) {
        const ld = angleDiff(angle, laneBiasAngle);
        laneScore = (1 - Math.abs(ld) / Math.PI) * AI_LANE_DISCIPLINE_WEIGHT;
      }

      let foodScore = 0;
      if (nearbyFoodList) {
        foodScore = this.scoreFoodForAngle(nearbyFoodList, angle, 260) * 1.5;
      }

      const totalScore = safetyScore * 3 + turnPenalty + momentumPenalty + biasScore + laneScore + foodScore;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestAngle = angle;
      }
    }

    return { angle: bestAngle, safety: bestScore };
  }

  recordDanger(x, y) {
    const key = cellKey(x, y);
    const current = this.dangerMemory.get(key) || 0;
    this.dangerMemory.set(key, Math.min(3, current + 1));
    if (this.dangerMemory.size > 60) {
      const firstKey = this.dangerMemory.keys().next().value;
      this.dangerMemory.delete(firstKey);
    }
  }

  decayMemory() {
    for (let [key, val] of this.dangerMemory) {
      const decayed = val * AI_MEMORY_DECAY;
      if (decayed < 0.05) this.dangerMemory.delete(key);
      else this.dangerMemory.set(key, decayed);
    }
  }

  recordRevenge(snakeRef) {
    this.revengeMemory.set(snakeRef, AI_REVENGE_MEMORY_DURATION);
  }

  decayRevengeMemory(dtSeconds) {
    for (let [snakeRef, timeLeft] of this.revengeMemory) {
      const remaining = timeLeft - dtSeconds;
      if (remaining <= 0 || !snakeRef.alive) this.revengeMemory.delete(snakeRef);
      else this.revengeMemory.set(snakeRef, remaining);
    }
  }

  hasRevengeAgainst(snakeRef) {
    return this.revengeMemory.has(snakeRef);
  }

  computeInterceptPoint(myHead, targetHead, targetVelX, targetVelY, mySpeed) {
    let t = 0;
    let px = targetHead.x, py = targetHead.y;
    for (let i = 0; i < AI_INTERCEPT_ITERATIONS; i++) {
      const dx = px - myHead.x, dy = py - myHead.y;
      const dist = Math.hypot(dx, dy);
      t = dist / Math.max(1, mySpeed);
      px = targetHead.x + targetVelX * t;
      py = targetHead.y + targetVelY * t;
    }
    return { x: px, y: py };
  }

  simpleFallbackThink(dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const head = this.segments[0];

    let avoidAngle = null;
    const dangerMargin = this.headRadius + 60;
    forEachNearbySegment(head.x, head.y, dangerMargin * 2, (entry) => {
      if (entry.snake === this && entry.index < 8) return false;
      if (!entry.snake.alive) return false;
      const seg = entry.seg;
      const dx = seg.x - head.x, dy = seg.y - head.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < (dangerMargin * 2) * (dangerMargin * 2)) {
        const escapeAngle = Math.atan2(head.y - seg.y, head.x - seg.x);
        const turn = angleDiff(escapeAngle, this.angle);
        avoidAngle = this.angle + (turn >= 0 ? Math.PI / 2 : -Math.PI / 2);
        return true;
      }
      return false;
    });

    const margin = 300;
    const distFromCenter = Math.hypot(head.x, head.y);
    let edgeAngle = null;
    if (distFromCenter > worldRadius - margin) {
      edgeAngle = Math.atan2(-head.y, -head.x);
    }

    if (avoidAngle !== null) {
      this.targetAngle = avoidAngle;
      this.boosting = false;
      return;
    }
    if (edgeAngle !== null) {
      this.targetAngle = edgeAngle;
      this.boosting = false;
      return;
    }

    if (this.stickyFoodTarget && foods.indexOf(this.stickyFoodTarget) === -1) {
      this.stickyFoodTarget = null;
    }
    if (!this.stickyFoodTarget) {
      let closest = null, closestDist = Infinity;
      forEachNearbyFood(head.x, head.y, 400, (f) => {
        const d = distSq(head.x, head.y, f.x, f.y);
        if (d < closestDist) { closestDist = d; closest = f; }
        return false;
      });
      this.stickyFoodTarget = closest;
    }
    if (this.stickyFoodTarget) {
      this.targetAngle = Math.atan2(this.stickyFoodTarget.y - head.y, this.stickyFoodTarget.x - head.x);
    } else {
      this.wanderTimer -= dtSeconds;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = this.angle + (Math.random() - 0.5) * 1.4;
        this.wanderTimer = 0.67 + Math.random() * 1.0;
      }
      this.targetAngle = this.wanderAngle;
    }
    this.boosting = false;
  }

  updateBoostEnergy(dtSeconds, wantsToBoost) {
    if (wantsToBoost && this.boostEnergy > 0) {
      this.boostEnergy = Math.max(0, this.boostEnergy - AI_BOOST_ENERGY_COST * dtSeconds);
      return true;
    }
    this.boostEnergy = Math.min(AI_BOOST_ENERGY_CAP, this.boostEnergy + AI_BOOST_ENERGY_REGEN * dtSeconds);
    return false;
  }

  think(allSnakes, dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const diff = getDifficulty();
    const head = this.segments[0];
    const turnRadius = this.speed / TURN_RATE;

    this.frameCounter++;
    this.updatePersonalityDrift(dtSeconds);
    this.updateMomentum(dtSeconds);
    this.decayRevengeMemory(dtSeconds);
    maybeDecayGroupSignals(dtSeconds);

    this.trapAssessTimer -= dtSeconds;
    if (this.trapAssessTimer <= 0) {
      this.trapAssessTimer = 0.3;
      this.decayMemory();
      this.decayTerritoryMemory();
      this.recordTerritoryVisit(head.x, head.y);

      const moved = Math.hypot(head.x - this.lastPos.x, head.y - this.lastPos.y);
      if (moved < 15) {
        this.stuckTimer += 0.3;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - 0.2);
      }
      this.lastPos = { x: head.x, y: head.y };
    }

    let closestFood = null;
    const searchRadius = 460;

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
        const turnNeeded = angleDiff(angleToFood, this.angle);
        const dist = Math.sqrt(d2);

        const reachable = dist > turnRadius * 0.5 || Math.abs(turnNeeded) < 0.6;
        if (!reachable) return false;

        const bucket = spatialFoodGrid.get(cellKey(f.x, f.y));
        const nearbyBonus = bucket ? bucket.length : 1;

        const distScore = 1 - Math.min(1, dist / searchRadius);
        const turnScore = 1 - Math.min(1, Math.abs(turnNeeded) / Math.PI);
        const valueScore = f.value / FOOD_MAX_VALUE;
        const clusterScore = Math.min(1, nearbyBonus / 8);
        const score = distScore * 0.35 + turnScore * 0.3 + valueScore * 0.15 + clusterScore * 0.2;

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

    const packRadius = AI_PACK_AWARENESS_RADIUS;
    const threats = this.gatherThreats(head.x, head.y, packRadius);
    const dangerMargin = this.headRadius + 55;

    this.updateAngerAndEncirclement(head, threats, dtSeconds);

    let mostUrgentThreat = null;
    let worstUrgency = -Infinity;
    let opportunityTarget = null;
    let dangerCount = 0;
    let sawPlayerThreat = null;

    for (let t of threats) {
      if (t.isSelf) continue;
      const dist = Math.sqrt(t.dist2);
      if (dist < dangerMargin * 3) dangerCount++;
      if (t.snake === player) sawPlayerThreat = t;

      if (dist < dangerMargin * 2.5) {
        const otherHead = t.snake.segments[0];
        const closingAngle = Math.atan2(otherHead.y - head.y, otherHead.x - head.x);
        const headOnFactor = Math.max(0, Math.cos(t.snake.angle - (closingAngle + Math.PI)));
        const proximityUrgency = 1 - Math.min(1, dist / (dangerMargin * 2.5));
        const sizeUrgency = t.snake.length > this.length * 1.05 ? 0.7 : 0.15;
        const revengeBoost = this.hasRevengeAgainst(t.snake) ? 0.3 : 0;
        const urgency = proximityUrgency * 1.4 + headOnFactor * AI_HEAD_ON_DANGER_BONUS + sizeUrgency - revengeBoost * 0.5;

        if (urgency > worstUrgency) {
          worstUrgency = urgency;
          mostUrgentThreat = t;
        }
      }

      const sizeThresholdForHunting = this.length * (0.75 - this.personalityCaution * 0.15);
      if (t.snake.length < sizeThresholdForHunting &&
          dist < dangerMargin * 2.2 &&
          this.personalityAggression > 0.35) {
        const otherHead = t.snake.segments[0];
        const d = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
        const revengeMultiplier = this.hasRevengeAgainst(t.snake) ? 1.5 : 1.0;
        if (!opportunityTarget || d < opportunityTarget.dist / revengeMultiplier) {
          opportunityTarget = { snake: t.snake, dist: d, revenge: this.hasRevengeAgainst(t.snake) };
        }
      }
    }

    if (mostUrgentThreat) {
      this.recordDanger(mostUrgentThreat.seg.x, mostUrgentThreat.seg.y);
      emitGroupSignal(mostUrgentThreat.seg.x, mostUrgentThreat.seg.y, "danger", 0.6);
    }

    this.panicTimer -= dtSeconds;
    if (this.encirclementScore > AI_PANIC_SCORE_THRESHOLD / 4 && this.playerIsAngerTarget) {
      this.panicMode = true;
      this.panicTimer = 1.2;
    } else if (this.panicTimer <= 0) {
      this.panicMode = false;
    }

    this.threatAssessTimer -= dtSeconds;
    if (this.threatAssessTimer <= 0) {
      this.threatAssessTimer = 0.2;
      this.fleeing = false;
      this.fleeFrom = null;
      if (mostUrgentThreat) {
        const dangerScale = 1.2 - this.personalityCaution * 0.3;
        const sizeAdvantageFactor = 1 - Math.min(0.4, this.confidence * AI_SIZE_ADVANTAGE_CONFIDENCE_SCALE);
        if (mostUrgentThreat.snake.length > this.length * dangerScale * sizeAdvantageFactor) {
          this.fleeing = true;
          this.fleeFrom = mostUrgentThreat.snake;
          if (mostUrgentThreat.snake === player) {
            this.recordRevenge(player);
          }
        }
      }
      if (dangerCount >= 3 && this.length < 200) {
        this.fleeing = true;
      }
      if (this.playerIsAngerTarget && this.angerLevel > AI_ENCIRCLEMENT_ANGER_THRESHOLD) {
        this.fleeing = true;
        this.fleeFrom = player;
      }
    }

    const successRatio = this.killChainCount > 0 ? 1 : 0.5;
    this.confidence += (successRatio - this.confidence) * AI_CONFIDENCE_SMOOTHING * dtSeconds;
    this.confidence = Math.min(1, Math.max(0, this.confidence));

    this.killChainTimer -= dtSeconds;
    if (this.killChainTimer <= 0) {
      this.killChainCount = 0;
    }

    let huntAngle = null;
    let huntingOpportunity = false;

    if (opportunityTarget && !this.fleeing) {
      const targetSnake = opportunityTarget.snake;
      const targetHead = targetSnake.segments[0];
      let aimX = targetHead.x, aimY = targetHead.y;

      if (this.personalityPatience > 0.5) {
        const targetVelX = Math.cos(targetSnake.angle) * (targetSnake.speed || BASE_SPEED);
        const targetVelY = Math.sin(targetSnake.angle) * (targetSnake.speed || BASE_SPEED);
        const intercept = this.computeInterceptPoint(head, targetHead, targetVelX, targetVelY, this.speed || BASE_SPEED);
        aimX = intercept.x;
        aimY = intercept.y;
      }

      huntAngle = Math.atan2(aimY - head.y, aimX - head.x);
      this.huntTargetIsPlayer = targetSnake.isPlayer;
      huntingOpportunity = true;
      this.state = "hunt";

      if (this.personalityPackAffinity > 0.5) {
        emitGroupSignal(targetHead.x, targetHead.y, "opportunity", 0.5);
      }
    } else if (player && player.alive) {
      globalPlayerTracker.update(dtSeconds);

      const dxp = player.segments[0].x - head.x;
      const dyp = player.segments[0].y - head.y;
      const distp2 = dxp * dxp + dyp * dyp;
      const inRange = distp2 < diff.huntRange * diff.huntRange;
      const sizeRatio = this.length / Math.max(1, player.length);
      const confidenceBonus = this.confidence * AI_SIZE_ADVANTAGE_CONFIDENCE_SCALE;
      const muchBigger = sizeRatio > (1.3 - this.personalityAggression * 0.3 - confidenceBonus);
      const muchSmaller = player.length > this.length * 1.3;
      const sizeOk = muchBigger && !muchSmaller && !this.fleeing;
      const revengeDrive = this.hasRevengeAgainst(player) ? 0.15 : 0;

      if (this.huntCommit > 0) {
        this.huntCommit -= dtSeconds;
      } else if (inRange && sizeOk && Math.random() < (diff.huntChance * this.personalityAggression + revengeDrive)) {
        this.huntCommit = 1.5 + Math.random() * 2;
      }

      if (this.huntCommit > 0 && inRange && sizeOk) {
        let aimX = player.segments[0].x;
        let aimY = player.segments[0].y;

        if (currentDifficulty === "hard" || this.personalityPatience > 0.6) {
          const predicted = globalPlayerTracker.predictFuturePosition(Math.hypot(dxp, dyp) / Math.max(1, this.speed || BASE_SPEED) * 0.5);
          if (predicted) {
            aimX = predicted.x;
            aimY = predicted.y;
          }
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

    const margin = 300;
    let edgeBias = null;
    const distFromCenter = Math.hypot(head.x, head.y);
    if (distFromCenter > worldRadius - margin - turnRadius) {
      edgeBias = Math.atan2(-head.y, -head.x);
    }

    const groupSignal = readGroupSignalNear(head.x, head.y, AI_GROUP_SIGNAL_RADIUS);

    let biasAngle = null;
    let biasWeight = 0;
    let wantFood = false;
    let laneBiasAngle = null;

    if ((this.fleeing || this.panicMode) && (mostUrgentThreat || this.fleeFrom)) {
      let escapeAngle;
      if (this.playerIsAngerTarget && this.encirclementDirection !== null) {
        escapeAngle = this.findEscapeCorridor(head, threats, dangerMargin);
      } else if (mostUrgentThreat) {
        escapeAngle = Math.atan2(head.y - mostUrgentThreat.seg.y, head.x - mostUrgentThreat.seg.x);
      } else if (this.fleeFrom && this.fleeFrom.alive) {
        const fh = this.fleeFrom.segments[0];
        escapeAngle = Math.atan2(head.y - fh.y, head.x - fh.x);
      } else {
        escapeAngle = this.angle + Math.PI;
      }
      biasAngle = escapeAngle;
      biasWeight = this.panicMode ? 3.2 : 2.5;
      this.stickyFoodTarget = null;
      this.state = this.panicMode ? "panic" : "flee";
    } else if (edgeBias !== null) {
      biasAngle = edgeBias;
      biasWeight = 2.0;
      this.state = "edge";
    } else if (huntAngle !== null) {
      biasAngle = huntAngle;
      biasWeight = 1.6;
      if (!huntingOpportunity) this.state = "hunt";
    } else if (closestFood) {
      biasAngle = Math.atan2(closestFood.y - head.y, closestFood.x - head.x);
      biasWeight = 1.1;
      wantFood = true;
      this.state = "seek";
    } else if (groupSignal.opportunity > 0.3 && this.personalityPackAffinity > 0.4) {
      biasAngle = Math.atan2(head.y, head.x) + Math.PI;
      biasWeight = 0.4;
      wantFood = true;
      this.state = "pack";
    } else {
      this.wanderTimer -= dtSeconds;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = this.angle + (Math.random() - 0.5) * 1.4;
        this.wanderTimer = 0.67 + Math.random() * 1.0;
      }
      biasAngle = this.wanderAngle;
      biasWeight = 0.6;
      wantFood = true;
      this.state = "wander";
    }

    if (groupSignal.dangerDirection !== null && groupSignal.danger > 0.5 && !this.fleeing) {
      laneBiasAngle = groupSignal.dangerDirection + Math.PI;
    }

    if (this.stuckTimer > 1.0) {
      biasAngle = this.angle + Math.PI * 0.6 + (Math.random() - 0.5) * AI_STUCK_ESCAPE_ANGLE_JITTER;
      biasWeight = 3.0;
    }

    const choice = this.chooseBestHeading(head, threats, dangerMargin, biasAngle, biasWeight, wantFood, laneBiasAngle);
    let desiredAngle = choice.angle;

    if (diff.reactionSlack > 0) {
      const da = angleDiff(desiredAngle, this.angle);
      desiredAngle = this.angle + da * (1 - diff.reactionSlack) + (Math.random() - 0.5) * diff.reactionSlack * 0.5;
    }

    this.targetAngle = desiredAngle;
    this.lastGoodAngle = desiredAngle;
    this.lastThinkAngleChoice = desiredAngle;

    this.lastBoostBurst -= dtSeconds;
    const frameNormalizer = dtSeconds * 60;
    let wantsBoost = false;

    if (this.segments.length > 60) {
      if ((this.fleeing || this.panicMode) && this.lastBoostBurst <= 0) {
        wantsBoost = Math.random() < diff.boostChanceFlee * frameNormalizer * (this.panicMode ? 3.0 : 2.2);
        if (wantsBoost) this.lastBoostBurst = 0.4;
      } else if (huntingOpportunity && opportunityTarget && opportunityTarget.dist < turnRadius * 1.5) {
        wantsBoost = Math.random() < diff.boostChanceHunt * frameNormalizer * 1.8;
        if (wantsBoost && opportunityTarget.dist < turnRadius * 0.8) {
          this.killChainCount++;
          this.killChainTimer = AI_KILLCHAIN_WINDOW;
        }
      } else if (this.state === "hunt" && !huntingOpportunity) {
        wantsBoost = Math.random() < diff.boostChanceHunt * frameNormalizer;
      } else if (this.state === "seek" && closestFood) {
        const fd = Math.hypot(closestFood.x - head.x, closestFood.y - head.y);
        wantsBoost = fd < turnRadius * 1.2 && Math.random() < diff.boostChanceSeek * frameNormalizer;
      } else {
        wantsBoost = false;
      }
    }

    this.boosting = this.updateBoostEnergy(dtSeconds, wantsBoost);

    this.updateStateMachine(dtSeconds);
    this.updateSizeTierProfile();
  }

  getSizeTier() {
    const len = this.length;
    if (len < 40) return "hatchling";
    if (len < 150) return "juvenile";
    if (len < 400) return "adult";
    if (len < 1000) return "elder";
    return "titan";
  }

  updateSizeTierProfile() {
    const tier = this.getSizeTier();
    if (tier === this._cachedTier) return;
    this._cachedTier = tier;

    switch (tier) {
      case "hatchling":
        this.tierSpeedConfidence = 0.6;
        this.tierRiskTolerance = 0.25;
        this.tierPreferredPackDistance = 250;
        break;
      case "juvenile":
        this.tierSpeedConfidence = 0.75;
        this.tierRiskTolerance = 0.4;
        this.tierPreferredPackDistance = 350;
        break;
      case "adult":
        this.tierSpeedConfidence = 0.9;
        this.tierRiskTolerance = 0.55;
        this.tierPreferredPackDistance = 450;
        break;
      case "elder":
        this.tierSpeedConfidence = 1.0;
        this.tierRiskTolerance = 0.7;
        this.tierPreferredPackDistance = 600;
        break;
      case "titan":
        this.tierSpeedConfidence = 1.0;
        this.tierRiskTolerance = 0.85;
        this.tierPreferredPackDistance = 800;
        break;
      default:
        this.tierSpeedConfidence = 0.8;
        this.tierRiskTolerance = 0.5;
        this.tierPreferredPackDistance = 400;
    }
  }

  getStateMachineTable() {
    return AISnake.STATE_TRANSITIONS;
  }

  updateStateMachine(dtSeconds) {
    if (!this.fsmState) this.fsmState = "spawn";
    this.fsmTimer = (this.fsmTimer || 0) + dtSeconds;

    const table = this.getStateMachineTable();
    const rules = table[this.fsmState];
    if (!rules) {
      this.fsmState = "idle";
      this.fsmTimer = 0;
      return;
    }

    for (let rule of rules) {
      if (rule.condition(this)) {
        if (rule.to !== this.fsmState) {
          this.fsmState = rule.to;
          this.fsmTimer = 0;
          this.onStateEnter(rule.to);
        }
        break;
      }
    }
  }

  onStateEnter(stateName) {
    switch (stateName) {
      case "enraged":
        this.angerLevel = Math.max(this.angerLevel, 0.8);
        break;
      case "recovering":
        this.confidence = Math.max(0.3, this.confidence - 0.15);
        break;
      case "dominant":
        this.confidence = Math.min(1, this.confidence + 0.1);
        break;
      default:
        break;
    }
  }

  layScentMarker() {
    if (!this._scentTrail) this._scentTrail = [];
    const head = this.segments[0];
    this._scentTrail.push({ x: head.x, y: head.y, strength: 1.0 });
    if (this._scentTrail.length > 40) this._scentTrail.shift();
  }

  decayScentTrail(dtSeconds) {
    if (!this._scentTrail) return;
    for (let i = this._scentTrail.length - 1; i >= 0; i--) {
      this._scentTrail[i].strength -= dtSeconds * 0.1;
      if (this._scentTrail[i].strength <= 0) this._scentTrail.splice(i, 1);
    }
  }

  getScentTrailDensityNear(x, y, radius) {
    if (!this._scentTrail || this._scentTrail.length === 0) return 0;
    let total = 0;
    for (let marker of this._scentTrail) {
      const dx = marker.x - x, dy = marker.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radius) total += marker.strength * (1 - dist / radius);
    }
    return total;
  }

  computeSelfOverlapAvoidanceBias() {
    if (!this._scentTrail || this._scentTrail.length < 5) return null;
    const head = this.segments[0];
    const density = this.getScentTrailDensityNear(head.x, head.y, 120);
    if (density < 1.5) return null;
    let avgX = 0, avgY = 0, count = 0;
    for (let marker of this._scentTrail) {
      const dx = marker.x - head.x, dy = marker.y - head.y;
      if (Math.hypot(dx, dy) < 120) {
        avgX += marker.x;
        avgY += marker.y;
        count++;
      }
    }
    if (count === 0) return null;
    avgX /= count;
    avgY /= count;
    return Math.atan2(head.y - avgY, head.x - avgX);
  }

  getDiagnosticsSnapshot() {
    return {
      name: this.name,
      length: this.length,
      state: this.state,
      fsmState: this.fsmState,
      sizeTier: this.getSizeTier(),
      angerLevel: Math.round(this.angerLevel * 100) / 100,
      encirclementScore: Math.round(this.encirclementScore * 100) / 100,
      confidence: Math.round(this.confidence * 100) / 100,
      fleeing: this.fleeing,
      panicMode: this.panicMode,
      boostEnergy: Math.round(this.boostEnergy * 10) / 10,
      personality: {
        aggression: Math.round(this.personalityAggression * 100) / 100,
        caution: Math.round(this.personalityCaution * 100) / 100,
        patience: Math.round(this.personalityPatience * 100) / 100,
        packAffinity: Math.round(this.personalityPackAffinity * 100) / 100
      }
    };
  }
}

AISnake.STATE_TRANSITIONS = {
  spawn: [
    { to: "settling", condition: (ai) => ai.fsmTimer > 0.5 }
  ],
  settling: [
    { to: "enraged", condition: (ai) => ai.playerIsAngerTarget && ai.angerLevel > 0.6 },
    { to: "cautious", condition: (ai) => ai.fleeing },
    { to: "foraging", condition: (ai) => ai.fsmTimer > 1.0 }
  ],
  foraging: [
    { to: "enraged", condition: (ai) => ai.playerIsAngerTarget && ai.angerLevel > 0.6 },
    { to: "cautious", condition: (ai) => ai.fleeing },
    { to: "dominant", condition: (ai) => ai.huntTargetIsPlayer && ai.confidence > 0.7 },
    { to: "foraging", condition: () => true }
  ],
  cautious: [
    { to: "enraged", condition: (ai) => ai.playerIsAngerTarget && ai.angerLevel > 0.8 },
    { to: "recovering", condition: (ai) => !ai.fleeing && ai.fsmTimer > 0.5 },
    { to: "cautious", condition: () => true }
  ],
  enraged: [
    { to: "recovering", condition: (ai) => !ai.playerIsAngerTarget && ai.angerLevel < 0.3 },
    { to: "enraged", condition: () => true }
  ],
  dominant: [
    { to: "recovering", condition: (ai) => !ai.huntTargetIsPlayer && ai.fsmTimer > 1.5 },
    { to: "cautious", condition: (ai) => ai.fleeing },
    { to: "dominant", condition: () => true }
  ],
  recovering: [
    { to: "foraging", condition: (ai) => ai.fsmTimer > 1.0 },
    { to: "enraged", condition: (ai) => ai.playerIsAngerTarget && ai.angerLevel > 0.6 },
    { to: "recovering", condition: () => true }
  ],
  idle: [
    { to: "settling", condition: () => true }
  ]
};
