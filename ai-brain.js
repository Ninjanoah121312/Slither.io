"use strict";

const AI_LOOKAHEAD_CANDIDATES = 6;
const AI_LOOKAHEAD_SPREAD = Math.PI * 0.75;
const AI_LOOKAHEAD_STEPS = 3;
const AI_LOOKAHEAD_STEP_TIME = 0.22;
const AI_MEMORY_DECAY = 0.92;
const AI_PACK_AWARENESS_RADIUS = 550;

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
    this.dangerMemory = new Map();
    this.personalityAggression = 0.4 + Math.random() * 0.6;
    this.personalityCaution = 0.3 + Math.random() * 0.7;
    this.lastGoodAngle = this.angle;
    this.stuckTimer = 0;
    this.lastPos = { x, y };
    this.trapAssessTimer = 0;
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
    return minClearance;
  }

  gatherNearbyFoodForScoring(head, searchRadius) {
    const list = [];
    forEachNearbyFood(head.x, head.y, searchRadius, (f) => {
      const dx = f.x - head.x, dy = f.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > searchRadius || dist < 1) return false;
      list.push({ angle: Math.atan2(dy, dx), dist, value: f.value });
      return false;
    });
    return list;
  }

  scoreFoodForAngle(nearbyFoodList, angle, searchRadius) {
    let bestScore = 0;
    for (let f of nearbyFoodList) {
      let diff = f.angle - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const alignScore = Math.max(0, 1 - Math.abs(diff) / (Math.PI * 0.5));
      if (alignScore <= 0) continue;
      const distScore = 1 - Math.min(1, f.dist / searchRadius);
      const valueScore = f.value / FOOD_MAX_VALUE;
      const s = alignScore * (0.5 + distScore * 0.3 + valueScore * 0.2);
      if (s > bestScore) bestScore = s;
    }
    return bestScore;
  }

  chooseBestHeading(head, threats, dangerMargin, biasAngle, biasWeight, wantFood) {
    const candidates = [];
    const baseAngle = this.angle;
    for (let i = 0; i < AI_LOOKAHEAD_CANDIDATES; i++) {
      const t = (i / (AI_LOOKAHEAD_CANDIDATES - 1)) - 0.5;
      candidates.push(baseAngle + t * AI_LOOKAHEAD_SPREAD);
    }

    const nearbyFoodList = wantFood ? this.gatherNearbyFoodForScoring(head, 260) : null;

    let bestAngle = baseAngle;
    let bestScore = -Infinity;

    for (let angle of candidates) {
      const safety = this.simulatePathSafety(head, angle, this.speed || BASE_SPEED, threats, dangerMargin);
      const safetyScore = Math.max(-500, safety) / 100;

      let turnPenalty = angle - baseAngle;
      while (turnPenalty > Math.PI) turnPenalty -= Math.PI * 2;
      while (turnPenalty < -Math.PI) turnPenalty += Math.PI * 2;
      const turnScore = -Math.abs(turnPenalty) * 0.15;

      let biasScore = 0;
      if (biasAngle !== null) {
        let bd = angle - biasAngle;
        while (bd > Math.PI) bd -= Math.PI * 2;
        while (bd < -Math.PI) bd += Math.PI * 2;
        biasScore = (1 - Math.abs(bd) / Math.PI) * biasWeight;
      }

      let foodScore = 0;
      if (nearbyFoodList) {
        foodScore = this.scoreFoodForAngle(nearbyFoodList, angle, 260) * 1.5;
      }

      const totalScore = safetyScore * 3 + turnScore + biasScore + foodScore;
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

  simpleFallbackThink(dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const head = this.segments[0];
    const diff = getDifficulty();

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
        let turn = escapeAngle - this.angle;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
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

  think(allSnakes, dt) {
    const dtSeconds = Math.min(dt, 100) / 1000;
    const diff = getDifficulty();
    const head = this.segments[0];
    const turnRadius = this.speed / TURN_RATE;

    this.trapAssessTimer -= dtSeconds;
    if (this.trapAssessTimer <= 0) {
      this.trapAssessTimer = 0.3;
      this.decayMemory();

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
        let turnNeeded = angleToFood - this.angle;
        while (turnNeeded > Math.PI) turnNeeded -= Math.PI * 2;
        while (turnNeeded < -Math.PI) turnNeeded += Math.PI * 2;
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

    let mostUrgentThreat = null;
    let worstUrgency = -Infinity;
    let opportunityTarget = null;
    let dangerCount = 0;

    for (let t of threats) {
      if (t.isSelf) continue;
      const dist = Math.sqrt(t.dist2);
      if (dist < dangerMargin * 3) dangerCount++;

      if (dist < dangerMargin * 2.5) {
        const otherHead = t.snake.segments[0];
        const closingAngle = Math.atan2(otherHead.y - head.y, otherHead.x - head.x);
        const headOnFactor = Math.max(0, Math.cos(t.snake.angle - (closingAngle + Math.PI)));
        const proximityUrgency = 1 - Math.min(1, dist / (dangerMargin * 2.5));
        const sizeUrgency = t.snake.length > this.length * 1.05 ? 0.7 : 0.15;
        const urgency = proximityUrgency * 1.4 + headOnFactor * 0.6 + sizeUrgency;

        if (urgency > worstUrgency) {
          worstUrgency = urgency;
          mostUrgentThreat = t;
        }
      }

      if (t.snake.length < this.length * (0.75 - this.personalityCaution * 0.15) &&
          dist < dangerMargin * 2.2 &&
          this.personalityAggression > 0.35) {
        const otherHead = t.snake.segments[0];
        const d = Math.hypot(otherHead.x - head.x, otherHead.y - head.y);
        if (!opportunityTarget || d < opportunityTarget.dist) {
          opportunityTarget = { snake: t.snake, dist: d };
        }
      }
    }

    if (mostUrgentThreat) {
      this.recordDanger(mostUrgentThreat.seg.x, mostUrgentThreat.seg.y);
    }

    this.threatAssessTimer -= dtSeconds;
    if (this.threatAssessTimer <= 0) {
      this.threatAssessTimer = 0.2;
      this.fleeing = false;
      this.fleeFrom = null;
      if (mostUrgentThreat) {
        const dangerScale = 1.2 - this.personalityCaution * 0.3;
        if (mostUrgentThreat.snake.length > this.length * dangerScale) {
          this.fleeing = true;
          this.fleeFrom = mostUrgentThreat.snake;
        }
      }
      if (dangerCount >= 3 && this.length < 200) {
        this.fleeing = true;
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
    } else if (player && player.alive) {
      const dxp = player.segments[0].x - head.x;
      const dyp = player.segments[0].y - head.y;
      const distp2 = dxp * dxp + dyp * dyp;
      const inRange = distp2 < diff.huntRange * diff.huntRange;
      const sizeRatio = this.length / Math.max(1, player.length);
      const muchBigger = sizeRatio > (1.3 - this.personalityAggression * 0.3);
      const muchSmaller = player.length > this.length * 1.3;
      const sizeOk = muchBigger && !muchSmaller && !this.fleeing;

      if (this.huntCommit > 0) {
        this.huntCommit -= dtSeconds;
      } else if (inRange && sizeOk && Math.random() < diff.huntChance * this.personalityAggression) {
        this.huntCommit = 1.5 + Math.random() * 2;
      }

      if (this.huntCommit > 0 && inRange && sizeOk) {
        let aimX = player.segments[0].x;
        let aimY = player.segments[0].y;
        if (currentDifficulty === "hard") {
          const leadTime = Math.hypot(dxp, dyp) / Math.max(1, this.speed);
          aimX += Math.cos(player.angle) * player.speed * leadTime * 0.4;
          aimY += Math.sin(player.angle) * player.speed * leadTime * 0.4;
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

    let biasAngle = null;
    let biasWeight = 0;
    let wantFood = false;

    if (this.fleeing && mostUrgentThreat) {
      const escapeAngle = Math.atan2(head.y - mostUrgentThreat.seg.y, head.x - mostUrgentThreat.seg.x);
      biasAngle = escapeAngle;
      biasWeight = 2.5;
      this.stickyFoodTarget = null;
      this.state = "flee";
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

    if (this.stuckTimer > 1.0) {
      biasAngle = this.angle + Math.PI * 0.6 + (Math.random() - 0.5) * 0.8;
      biasWeight = 3.0;
    }

    const choice = this.chooseBestHeading(head, threats, dangerMargin, biasAngle, biasWeight, wantFood);
    let desiredAngle = choice.angle;

    if (diff.reactionSlack > 0) {
      let da = desiredAngle - this.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      desiredAngle = this.angle + da * (1 - diff.reactionSlack) + (Math.random() - 0.5) * diff.reactionSlack * 0.5;
    }

    this.targetAngle = desiredAngle;
    this.lastGoodAngle = desiredAngle;

    this.lastBoostBurst -= dtSeconds;
    const frameNormalizer = dtSeconds * 60;
    if (this.segments.length > 60) {
      if (this.fleeing && this.lastBoostBurst <= 0) {
        this.boosting = Math.random() < diff.boostChanceFlee * frameNormalizer * 2.2;
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
