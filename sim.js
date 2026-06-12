'use strict';

// グループ定義: グー→チョキ→パー→グー の三すくみ
const GROUPS = ['gu', 'choki', 'pa'];
const CATCHES = { gu: 'choki', choki: 'pa', pa: 'gu' };   // 自分が捕まえに行く相手(獲物)
const CAUGHT_BY = { choki: 'gu', pa: 'choki', gu: 'pa' }; // 自分を捕まえる相手

const FIELD_WIDTH = 800;   // 盤面の論理幅 px
const FIELD_HEIGHT = 600;  // 盤面の論理高さ px
const CAPTURE_RADIUS = 16; // 捕獲半径 px
const MIN_SPEED = 5;       // 最低速度 px/秒
const MAX_DT = 0.1;        // 1フレームの最大経過時間(秒)
const FLEE_WEIGHT = 1.5;   // 逃走の重み係数(追跡は1.0)

// 正規分布乱数(Box-Muller法)。rand は注入可能(テスト用)
function randNormal(mean, sd, rand = Math.random) {
  if (sd === 0) return mean; // 明示的な特例: ばらつきなし
  let u1;
  do { u1 = rand(); } while (u1 === 0); // log(0) を避ける
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

class Agent {
  constructor(group, x, y, speed) {
    this.group = group;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.alive = true;
  }

  distanceTo(other) {
    return Math.hypot(other.x - this.x, other.y - this.y);
  }

  // agents の中から、指定グループの最近接の生存者を返す(いなければ null)
  nearestOf(agents, group) {
    let nearest = null;
    let minDist = Infinity;
    for (const a of agents) {
      if (a === this || !a.alive || a.group !== group) continue;
      const d = this.distanceTo(a);
      if (d < minDist) {
        minDist = d;
        nearest = a;
      }
    }
    return nearest;
  }

  // 移動方向の単位ベクトル {x, y} を返す。動く理由がなければ null
  // 追跡: 1/d の重みで獲物へ、逃走: FLEE_WEIGHT/d の重みで脅威の反対へ。
  // 距離の逆数の重み付けにより、近い相手ほど行動に強く影響する
  direction(agents) {
    const prey = this.nearestOf(agents, CATCHES[this.group]);
    const threat = this.nearestOf(agents, CAUGHT_BY[this.group]);
    let dx = 0;
    let dy = 0;
    if (prey) {
      const d = Math.max(this.distanceTo(prey), 1e-6);
      dx += ((prey.x - this.x) / d) * (1 / d);
      dy += ((prey.y - this.y) / d) * (1 / d);
    }
    if (threat) {
      const d = Math.max(this.distanceTo(threat), 1e-6);
      dx += ((this.x - threat.x) / d) * (FLEE_WEIGHT / d);
      dy += ((this.y - threat.y) / d) * (FLEE_WEIGHT / d);
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    return { x: dx / len, y: dy / len };
  }
}

// Node のテストから読めるようにする(ブラウザでは module が無いため無視される)
if (typeof module !== 'undefined') {
  module.exports = {
    randNormal, Agent,
    GROUPS, CATCHES, CAUGHT_BY,
    FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
  };
}
