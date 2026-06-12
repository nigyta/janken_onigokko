# じゃんけん鬼ごっこ シミュレーション 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グー・チョキ・パーの3グループが三すくみで追いかけ合う「じゃんけん鬼ごっこ」を、ブラウザでリアルタイムに可視化するシミュレーションを作る。

**Architecture:** シミュレーションロジック(`sim.js`、Canvas非依存の純粋ロジック)と、UI・描画(`index.html`)を完全分離する。ロジックは `test.js`(Node標準のテストランナー)でテストする。外部依存ゼロ、`index.html` のダブルクリックで起動。

**Tech Stack:** 素のJavaScript、Canvas 2D、Node組み込みテストランナー(`node:test` + `node:assert`、Node 18以上。実行環境は Node v24 確認済み)

**設計書:** `docs/superpowers/specs/2026-06-13-junken-onigokko-design.md`

---

## ファイル構成

```
junken_onigokko/
├── index.html   … 画面(左サイドバー+Canvas)、CSS、Renderer・UIController
├── sim.js       … randNormal / Agent / Simulation(描画と完全分離)
└── test.js      … sim.js のテスト(node test.js で実行)
```

- `sim.js` は `<script src>` で読み込む普通のJS(非モジュール)。末尾の
  `if (typeof module !== 'undefined') module.exports = ...` で Node からも読める
- すべてのコマンドはリポジトリルート(`/Users/tanizawa/ws_test/junken_onigokko`)で実行する

## 用語・定数(全タスク共通)

| 名前 | 値 | 意味 |
|---|---|---|
| グループ識別子 | `'gu'` `'choki'` `'pa'` | グー・チョキ・パー |
| `CATCHES` | `{gu:'choki', choki:'pa', pa:'gu'}` | 自分が捕まえられる相手 |
| `CAUGHT_BY` | `{choki:'gu', pa:'choki', gu:'pa'}` | 自分を捕まえる相手 |
| `FIELD_WIDTH` / `FIELD_HEIGHT` | 800 / 600 | 盤面の論理座標系 px |
| `CAPTURE_RADIUS` | 16 | 捕獲半径 px |
| `MIN_SPEED` | 5 | 最低速度 px/秒 |
| `MAX_DT` | 0.1 | 1フレームの最大経過時間 秒 |
| `FLEE_WEIGHT` | 1.5 | 逃走の重み係数 |

`Simulation` のパラメータオブジェクト: `{ n, duration, meanSpeed, speedSd }`
(人数/グループ、時間 秒、平均速度 px/秒、速度の標準偏差 px/秒)

---

### Task 1: テスト基盤と randNormal(正規分布乱数)

**Files:**
- Create: `test.js`
- Create: `sim.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` を以下の内容で新規作成する:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  randNormal, Agent, Simulation,
  GROUPS, CATCHES, CAUGHT_BY,
  FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
} = require('./sim.js');

test('randNormal: 平均と標準偏差が指定値に収束する', () => {
  const n = 100000;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = randNormal(50, 10);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const sd = Math.sqrt(sumSq / n - mean * mean);
  assert.ok(Math.abs(mean - 50) < 0.5, `mean=${mean}`);
  assert.ok(Math.abs(sd - 10) < 0.5, `sd=${sd}`);
});

test('randNormal: 標準偏差0なら常に平均値', () => {
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(randNormal(80, 0), 80);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `Cannot find module './sim.js'`

- [ ] **Step 3: 最小限の実装を書く**

`sim.js` を以下の内容で新規作成する:

```js
'use strict';

// 正規分布乱数(Box-Muller法)。rand は注入可能(テスト用)
function randNormal(mean, sd, rand = Math.random) {
  if (sd === 0) return mean; // 明示的な特例: ばらつきなし
  let u1;
  do { u1 = rand(); } while (u1 === 0); // log(0) を避ける
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

// Node のテストから読めるようにする(ブラウザでは module が無いため無視される)
if (typeof module !== 'undefined') {
  module.exports = { randNormal };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 2` `# fail 0`
(注: `Agent` などまだ未定義の名前の分割代入は `undefined` になるだけでエラーにはならない)

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "randNormal(Box-Muller法)とテスト基盤を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 三すくみ定義と Agent(最近接探索)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('三すくみ: グー→チョキ→パー→グー', () => {
  assert.deepStrictEqual(GROUPS, ['gu', 'choki', 'pa']);
  assert.strictEqual(CATCHES.gu, 'choki');
  assert.strictEqual(CATCHES.choki, 'pa');
  assert.strictEqual(CATCHES.pa, 'gu');
  assert.strictEqual(CAUGHT_BY.choki, 'gu');
  assert.strictEqual(CAUGHT_BY.pa, 'choki');
  assert.strictEqual(CAUGHT_BY.gu, 'pa');
});

test('Agent: distanceTo はユークリッド距離', () => {
  const a = new Agent('gu', 0, 0, 10);
  const b = new Agent('choki', 3, 4, 10);
  assert.strictEqual(a.distanceTo(b), 5);
});

test('Agent: 最近接の生存している指定グループを選ぶ', () => {
  const me = new Agent('gu', 0, 0, 10);
  const dead = new Agent('choki', 50, 0, 10);
  dead.alive = false;
  const near = new Agent('choki', 100, 0, 10);
  const far = new Agent('choki', 200, 0, 10);
  const otherGroup = new Agent('pa', 10, 0, 10);
  const agents = [me, dead, near, far, otherGroup];
  assert.strictEqual(me.nearestOf(agents, CATCHES[me.group]), near);
});

test('Agent: 対象グループが全滅なら nearestOf は null', () => {
  const me = new Agent('gu', 0, 0, 10);
  assert.strictEqual(me.nearestOf([me], 'choki'), null);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `Agent is not a constructor`(および三すくみテストの `undefined` 不一致)

- [ ] **Step 3: 実装を書く**

`sim.js` の `randNormal` 関数の上に定数ブロックを追加する:

```js
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
```

`randNormal` 関数の下に `Agent` クラスを追加する:

```js
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
}
```

`sim.js` 末尾の `module.exports` を以下に置き換える:

```js
if (typeof module !== 'undefined') {
  module.exports = {
    randNormal, Agent,
    GROUPS, CATCHES, CAUGHT_BY,
    FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 6` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "三すくみ定義とAgentクラス(最近接探索)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Agent.direction(追跡・逃走の重み付き合成)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('direction: 獲物のみ → 獲物に向かう単位ベクトル', () => {
  const me = new Agent('gu', 100, 100, 10);
  const prey = new Agent('choki', 200, 100, 10);
  const dir = me.direction([me, prey]);
  assert.ok(Math.abs(dir.x - 1) < 1e-9, `dir.x=${dir.x}`);
  assert.ok(Math.abs(dir.y) < 1e-9, `dir.y=${dir.y}`);
});

test('direction: 脅威のみ → 反対方向に逃げる', () => {
  const me = new Agent('gu', 100, 100, 10);
  const threat = new Agent('pa', 200, 100, 10);
  const dir = me.direction([me, threat]);
  assert.ok(Math.abs(dir.x + 1) < 1e-9, `dir.x=${dir.x}`);
  assert.ok(Math.abs(dir.y) < 1e-9, `dir.y=${dir.y}`);
});

test('direction: 獲物と脅威が同方向・同距離なら逃走が勝つ', () => {
  const me = new Agent('gu', 100, 100, 10);
  const prey = new Agent('choki', 200, 100, 10);
  const threat = new Agent('pa', 200, 100, 10);
  const dir = me.direction([me, prey, threat]);
  // 逃走の重み 1.5 が追跡の 1.0 に勝ち、合成は厳密に {-1, 0} になる
  assert.ok(Math.abs(dir.x + 1) < 1e-9, `dir.x=${dir.x}`);
  assert.ok(Math.abs(dir.y) < 1e-9, `dir.y=${dir.y}`);

  // より現実的な配置: 近い脅威(d=50)からの逃走が遠い獲物(d=100)への追跡に勝つ
  const nearThreat = new Agent('pa', 150, 100, 10);
  const dir2 = me.direction([me, prey, nearThreat]);
  assert.ok(Math.abs(dir2.x + 1) < 1e-9, `dir2.x=${dir2.x}`);
  assert.ok(Math.abs(dir2.y) < 1e-9, `dir2.y=${dir2.y}`);
});

test('direction: 獲物も脅威もいなければ null(その場で停止)', () => {
  const me = new Agent('gu', 100, 100, 10);
  assert.strictEqual(me.direction([me]), null);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `me.direction is not a function`

- [ ] **Step 3: 実装を書く**

`Agent` クラスの `nearestOf` メソッドの下に追加する:

```js
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 10` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "Agent.direction(追跡・逃走の重み付き合成)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Simulation の初期化(配置・速度生成)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('Simulation: 各グループ N 人ずつ生成され、初期状態が正しい', () => {
  const sim = new Simulation({ n: 10, duration: 60, meanSpeed: 80, speedSd: 15 });
  assert.strictEqual(sim.agents.length, 30);
  assert.deepStrictEqual(sim.aliveCounts(), { gu: 10, choki: 10, pa: 10 });
  assert.strictEqual(sim.timeLeft, 60);
  assert.strictEqual(sim.finished, false);
  assert.strictEqual(sim.winner, null);
});

test('Simulation: 初期配置は各グループの担当エリア内', () => {
  const sim = new Simulation({ n: 30, duration: 60, meanSpeed: 80, speedSd: 15 });
  // 左上=グー、右上=チョキ、下中央=パー(各エリアは盤面の1/4サイズ)
  const areas = {
    gu:    { x0: 0,   y0: 0,   x1: 400, y1: 300 },
    choki: { x0: 400, y0: 0,   x1: 800, y1: 300 },
    pa:    { x0: 200, y0: 300, x1: 600, y1: 600 },
  };
  for (const a of sim.agents) {
    const ar = areas[a.group];
    assert.ok(a.x >= ar.x0 && a.x <= ar.x1, `${a.group} x=${a.x}`);
    assert.ok(a.y >= ar.y0 && a.y <= ar.y1, `${a.group} y=${a.y}`);
  }
});

test('Simulation: 速度は正規分布から生成され最低速度でクランプされる', () => {
  // 標準偏差を極端に大きくして負の値が出る状況を作る
  const sim = new Simulation({ n: 100, duration: 60, meanSpeed: 10, speedSd: 1000 });
  for (const a of sim.agents) {
    assert.ok(a.speed >= MIN_SPEED, `speed=${a.speed}`);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `Simulation is not a constructor`

- [ ] **Step 3: 実装を書く**

`sim.js` の `Agent` クラスの下に追加する:

```js
class Simulation {
  // params: { n, duration, meanSpeed, speedSd } / rand はテスト用に注入可能
  constructor(params, rand = Math.random) {
    this.params = params;
    this.rand = rand;
    this.timeLeft = params.duration;
    this.finished = false;
    this.winner = null; // グループ識別子 | 'draw' | null(進行中)
    this.agents = [];

    // 3グループを離れた3エリアに配置(開始直後の即捕獲を防ぐ)
    // 左上=グー、右上=チョキ、下中央=パー(各エリアは盤面の1/4サイズ)
    const areas = {
      gu:    { x: 0,               y: 0,                w: FIELD_WIDTH / 2, h: FIELD_HEIGHT / 2 },
      choki: { x: FIELD_WIDTH / 2, y: 0,                w: FIELD_WIDTH / 2, h: FIELD_HEIGHT / 2 },
      pa:    { x: FIELD_WIDTH / 4, y: FIELD_HEIGHT / 2, w: FIELD_WIDTH / 2, h: FIELD_HEIGHT / 2 },
    };
    for (const group of GROUPS) {
      const area = areas[group];
      for (let i = 0; i < params.n; i++) {
        const x = area.x + this.rand() * area.w;
        const y = area.y + this.rand() * area.h;
        const speed = Math.max(
          randNormal(params.meanSpeed, params.speedSd, this.rand),
          MIN_SPEED
        );
        this.agents.push(new Agent(group, x, y, speed));
      }
    }
  }

  // グループごとの生存者数 { gu, choki, pa }
  aliveCounts() {
    const counts = { gu: 0, choki: 0, pa: 0 };
    for (const a of this.agents) {
      if (a.alive) counts[a.group]++;
    }
    return counts;
  }
}
```

`sim.js` 末尾の `module.exports` を以下に置き換える:

```js
if (typeof module !== 'undefined') {
  module.exports = {
    randNormal, Agent, Simulation,
    GROUPS, CATCHES, CAUGHT_BY,
    FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 13` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "Simulationの初期化(3エリア配置・正規分布速度)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: tick — 移動・壁クランプ・dtクランプ

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
// 手動でエージェントを配置するテスト用ヘルパー(n:0 で空のSimulationを作る)
function makeEmptySim(duration = 60) {
  return new Simulation({ n: 0, duration, meanSpeed: 80, speedSd: 0 });
}

test('tick: 追跡方向に speed×dt だけ移動する', () => {
  const sim = makeEmptySim();
  const hunter = new Agent('gu', 100, 100, 10);
  const prey = new Agent('choki', 700, 100, 0); // speed 0 なので動かない
  sim.agents.push(hunter, prey);
  sim.tick(0.1);
  assert.ok(Math.abs(hunter.x - 101) < 1e-9, `x=${hunter.x}`); // 10×0.1 = 1px 前進
  assert.ok(Math.abs(hunter.y - 100) < 1e-9, `y=${hunter.y}`);
});

test('tick: 壁の外には出ない', () => {
  const sim = makeEmptySim();
  const runner = new Agent('gu', 1, 100, 100);
  const threat = new Agent('pa', 50, 100, 0);
  sim.agents.push(runner, threat);
  sim.tick(0.1); // -x 方向に 10px 逃げようとするが壁でクランプ
  assert.strictEqual(runner.x, 0);
});

test('tick: dt は MAX_DT(0.1秒)にクランプされる', () => {
  const sim = makeEmptySim();
  const hunter = new Agent('gu', 100, 100, 10);
  const prey = new Agent('choki', 700, 100, 0);
  sim.agents.push(hunter, prey);
  sim.tick(5); // タブ非アクティブ復帰を模擬
  assert.ok(Math.abs(hunter.x - 101) < 1e-9, `x=${hunter.x}`); // 0.1秒ぶんしか動かない
  assert.ok(Math.abs(sim.timeLeft - 59.9) < 1e-9, `timeLeft=${sim.timeLeft}`);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `sim.tick is not a function`

- [ ] **Step 3: 実装を書く**

`Simulation` クラスの `aliveCounts` メソッドの下に追加する:

```js
  // dt 秒ぶんシミュレーションを進める(移動のみ。捕獲・終了判定は後続タスクで追加)
  // 注: 移動は配列順の逐次更新(意図的な選択)。スナップショット一括更新との差は
  // 1フレームあたり最大数px で知覚不能なため、毎フレームの複製コストを避け単純さを優先
  tick(dt) {
    if (this.finished) return;
    dt = Math.min(dt, MAX_DT);
    this.timeLeft -= dt;

    // 移動(壁の内側にクランプ)
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      const dir = agent.direction(this.agents);
      if (!dir) continue;
      agent.x = Math.min(Math.max(agent.x + dir.x * agent.speed * dt, 0), FIELD_WIDTH);
      agent.y = Math.min(Math.max(agent.y + dir.y * agent.speed * dt, 0), FIELD_HEIGHT);
    }
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 16` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "tick(移動・壁クランプ・dtクランプ)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 捕獲判定(一括除外・同時捕獲)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する(`makeEmptySim` は Task 5 で定義済み):

```js
test('捕獲: 捕獲半径内の捕食関係は捕まる(捕まえた側は残る)', () => {
  const sim = makeEmptySim();
  const hunter = new Agent('gu', 100, 100, 0);
  const prey = new Agent('choki', 110, 100, 0); // 距離10 < CAPTURE_RADIUS(16)
  sim.agents.push(hunter, prey);
  sim.tick(0.001);
  assert.strictEqual(prey.alive, false);
  assert.strictEqual(hunter.alive, true);
});

test('捕獲: 捕食関係がなければ捕まらない', () => {
  const sim = makeEmptySim();
  const a = new Agent('gu', 100, 100, 0);
  const b = new Agent('gu', 110, 100, 0); // 同グループ同士
  sim.agents.push(a, b);
  sim.tick(0.001);
  assert.strictEqual(a.alive, true);
  assert.strictEqual(b.alive, true);
});

test('捕獲: 捕獲半径以上の距離なら捕まらない(境界含む)', () => {
  const sim = makeEmptySim();
  const hunter = new Agent('gu', 100, 100, 0);
  const far = new Agent('choki', 120, 100, 0);        // 距離20 > 16
  const atBoundary = new Agent('choki', 116, 100, 0); // 距離ちょうど16(< でなく <= なら捕まる)
  sim.agents.push(hunter, far, atBoundary);
  sim.tick(0.001);
  assert.strictEqual(far.alive, true);
  assert.strictEqual(atBoundary.alive, true);
});

test('捕獲: 同一フレームの同時捕獲は両方有効', () => {
  const sim = makeEmptySim();
  const gu = new Agent('gu', 100, 100, 0);
  const choki = new Agent('choki', 110, 100, 0); // gu との距離10
  const pa = new Agent('pa', 90, 100, 0);        // gu との距離10、choki との距離20
  sim.agents.push(gu, choki, pa);
  sim.tick(0.001);
  // gu は choki を捕まえ、同時に pa は gu を捕まえる(両方有効)
  assert.strictEqual(choki.alive, false);
  assert.strictEqual(gu.alive, false);
  assert.strictEqual(pa.alive, true);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 捕獲系テスト4件中2件が失敗(「捕獲半径内」と「同時捕獲」。`prey.alive` が `true` のまま)。
「捕食関係がなければ捕まらない」「半径より遠ければ捕まらない」は実装前から通る

- [ ] **Step 3: 実装を書く**

`Simulation.tick` の移動ループの下(メソッドの末尾)に追加する:

```js
    // 捕獲判定: 全ペアを収集してから一括除外する。
    // 「AがBを捕まえる瞬間にCもAを捕まえる」場合は両方有効(同時とみなす)。
    // 判定順序による不公平をなくすため
    const caught = new Set();
    const alive = this.agents.filter((a) => a.alive);
    for (const hunter of alive) {
      for (const prey of alive) {
        if (CATCHES[hunter.group] !== prey.group) continue;
        if (hunter.distanceTo(prey) < CAPTURE_RADIUS) caught.add(prey);
      }
    }
    for (const a of caught) a.alive = false;
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 20` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "捕獲判定(一括除外・同時捕獲対応)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 終了判定と勝者決定

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('終了: 時間切れで最多残存グループの勝ち', () => {
  const sim = makeEmptySim(1); // duration 1秒
  sim.agents.push(
    new Agent('gu', 0, 0, 0),
    new Agent('gu', 0, 100, 0),
    new Agent('choki', 790, 590, 0) // 遠くにいるので捕獲は起きない
  );
  for (let i = 0; i < 11; i++) sim.tick(0.1); // 1.1秒ぶん進める
  assert.strictEqual(sim.finished, true);
  assert.strictEqual(sim.timeLeft, 0); // 負にならず0で止まる
  assert.strictEqual(sim.winner, 'gu'); // 2人 vs 1人
});

test('終了: 同数なら引き分け', () => {
  const sim = makeEmptySim(1);
  sim.agents.push(
    new Agent('gu', 0, 0, 0),
    new Agent('choki', 790, 590, 0)
  );
  for (let i = 0; i < 11; i++) sim.tick(0.1);
  assert.strictEqual(sim.finished, true);
  assert.strictEqual(sim.winner, 'draw');
});

test('終了: 残存グループが1つになったら時間内でも終了(膠着)', () => {
  const sim = makeEmptySim(); // duration 60秒
  const gu = new Agent('gu', 100, 100, 0);
  const choki = new Agent('choki', 110, 100, 0);
  sim.agents.push(gu, choki);
  sim.tick(0.001); // gu が choki を捕獲 → gu のみ残存
  assert.strictEqual(sim.finished, true);
  assert.strictEqual(sim.winner, 'gu');
  assert.ok(sim.timeLeft > 0); // 時間はまだ残っている
});

test('終了後: tick しても状態が変わらない', () => {
  const sim = makeEmptySim();
  const gu = new Agent('gu', 100, 100, 0);
  const choki = new Agent('choki', 110, 100, 0);
  sim.agents.push(gu, choki);
  sim.tick(0.001); // ここで膠着終了
  const timeLeftAfterFinish = sim.timeLeft;
  sim.tick(0.1);
  assert.strictEqual(sim.timeLeft, timeLeftAfterFinish);
  assert.strictEqual(sim.winner, 'gu');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 終了系テスト4件が失敗(`sim.finished` が `false` のまま等)

- [ ] **Step 3: 実装を書く**

`Simulation.tick` の捕獲判定の下(メソッドの末尾)に追加する:

```js
    // 終了判定: 時間切れ、または膠着(残存グループが1つ以下)
    const counts = this.aliveCounts();
    const survivingGroups = GROUPS.filter((g) => counts[g] > 0);
    if (this.timeLeft <= 0 || survivingGroups.length <= 1) {
      this.timeLeft = Math.max(this.timeLeft, 0);
      this.finished = true;
      const max = Math.max(counts.gu, counts.choki, counts.pa);
      const winners = GROUPS.filter((g) => counts[g] === max);
      this.winner = winners.length === 1 ? winners[0] : 'draw';
    }
```

あわせて `tick` メソッドの先頭コメントを実態に合わせて更新する:

```js
  // dt 秒ぶんシミュレーションを進める(移動 → 捕獲判定 → 終了判定)
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 24` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "終了判定(時間切れ・膠着)と勝者決定を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: index.html(UI・描画)と手動確認

**Files:**
- Create: `index.html`

- [ ] **Step 1: index.html を作成する**

`index.html` を以下の内容で新規作成する:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>じゃんけん鬼ごっこ</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex;
    background: #1a1a2e; color: #eee;
    font-family: "Hiragino Sans", "Noto Sans JP", sans-serif;
  }
  #sidebar {
    width: 240px; flex-shrink: 0; background: #16213e;
    padding: 16px; display: flex; flex-direction: column; gap: 14px;
  }
  h1 { font-size: 16px; margin: 0 0 4px; }
  label { font-size: 12px; color: #aaa; display: block; }
  input[type="range"] { width: 100%; }
  button {
    padding: 8px; border: none; border-radius: 6px;
    font-size: 14px; font-weight: bold; cursor: pointer;
  }
  #startBtn { background: #e94560; color: #fff; }
  #resetBtn { background: #444; color: #eee; }
  #status { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
  #timer { font-size: 18px; font-weight: bold; }
  .count { font-size: 16px; font-weight: bold; }
  .count.gu { color: #e74c3c; }
  .count.choki { color: #2ecc71; }
  .count.pa { color: #3498db; }
  #board {
    flex: 1; display: flex; align-items: center; justify-content: center;
    position: relative; padding: 16px;
  }
  canvas {
    background: #0f0f1a; border-radius: 8px;
    max-width: 100%; max-height: 100%;
  }
  #overlay {
    position: absolute; inset: 0;
    display: none; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    font-size: 36px; font-weight: bold; text-align: center;
  }
</style>
</head>
<body>
<div id="sidebar">
  <h1>じゃんけん鬼ごっこ</h1>
  <div>
    <label>人数 N(グループごと): <span id="nValue">10</span> 人</label>
    <input type="range" id="nSlider" min="1" max="100" value="10">
  </div>
  <div>
    <label>シミュレーション時間: <span id="durValue">60</span> 秒</label>
    <input type="range" id="durSlider" min="10" max="300" value="60">
  </div>
  <div>
    <label>平均速度: <span id="speedValue">80</span> px/秒</label>
    <input type="range" id="speedSlider" min="10" max="300" value="80">
  </div>
  <div>
    <label>速度の標準偏差: <span id="sdValue">15</span> px/秒</label>
    <input type="range" id="sdSlider" min="0" max="100" value="15">
  </div>
  <button id="startBtn">スタート</button>
  <button id="resetBtn">リセット</button>
  <div id="status">
    <div id="timer">⏱ ─</div>
    <div class="count gu">✊ グー <span id="countGu">-</span> 人</div>
    <div class="count choki">✌️ チョキ <span id="countChoki">-</span> 人</div>
    <div class="count pa">✋ パー <span id="countPa">-</span> 人</div>
  </div>
</div>
<div id="board">
  <canvas id="field" width="800" height="600"></canvas>
  <div id="overlay"></div>
</div>

<script src="sim.js"></script>
<script>
'use strict';

// ---- Renderer ----
const EMOJI = { gu: '✊', choki: '✌️', pa: '✋' };
const COLOR = { gu: '#e74c3c', choki: '#2ecc71', pa: '#3498db' };
const NAME = { gu: 'グー', choki: 'チョキ', pa: 'パー' };

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');

function draw(sim) {
  ctx.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.font = '24px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 12;
  for (const a of sim.agents) {
    if (!a.alive) continue;
    ctx.shadowColor = COLOR[a.group]; // グループ色の光彩
    ctx.fillText(EMOJI[a.group], a.x, a.y);
  }
  ctx.shadowBlur = 0;
}

// ---- UIController ----
const $ = (id) => document.getElementById(id);

// スライダーの値表示を連動させる
const sliderPairs = [
  ['nSlider', 'nValue'],
  ['durSlider', 'durValue'],
  ['speedSlider', 'speedValue'],
  ['sdSlider', 'sdValue'],
];
for (const [sliderId, valueId] of sliderPairs) {
  $(sliderId).addEventListener('input', () => {
    $(valueId).textContent = $(sliderId).value;
  });
}

function readParams() {
  return {
    n: Number($('nSlider').value),
    duration: Number($('durSlider').value),
    meanSpeed: Number($('speedSlider').value),
    speedSd: Number($('sdSlider').value),
  };
}

let sim = null;
let running = false;
let lastTime = null;

function updateStatus() {
  const counts = sim.aliveCounts();
  $('timer').textContent = `⏱ 残り ${sim.timeLeft.toFixed(1)} 秒`;
  $('countGu').textContent = counts.gu;
  $('countChoki').textContent = counts.choki;
  $('countPa').textContent = counts.pa;
}

function showOverlay() {
  const overlay = $('overlay');
  if (sim.winner === 'draw') {
    overlay.textContent = '引き分け';
    overlay.style.color = '#eee';
  } else {
    const counts = sim.aliveCounts();
    overlay.textContent =
      `${EMOJI[sim.winner]} ${NAME[sim.winner]}の勝ち!(残り ${counts[sim.winner]} 人)`;
    overlay.style.color = COLOR[sim.winner];
  }
  overlay.style.display = 'flex';
}

function loop(t) {
  if (!running) return;
  const dt = lastTime === null ? 0 : (t - lastTime) / 1000;
  lastTime = t;
  sim.tick(dt);
  draw(sim);
  updateStatus();
  if (sim.finished) {
    running = false;
    showOverlay();
    return;
  }
  requestAnimationFrame(loop);
}

function start() {
  sim = new Simulation(readParams());
  running = true;
  lastTime = null;
  $('overlay').style.display = 'none';
  requestAnimationFrame(loop);
}

function reset() {
  running = false;
  $('overlay').style.display = 'none';
  sim = new Simulation(readParams());
  draw(sim);
  updateStatus();
}

$('startBtn').addEventListener('click', start);
$('resetBtn').addEventListener('click', reset);

reset(); // 初期表示(配置のみ)
</script>
</body>
</html>
```

- [ ] **Step 2: 全テストが通ったままであることを確認する**

Run: `node test.js`
Expected: `# pass 24` `# fail 0`

- [ ] **Step 3: ブラウザで手動確認する**

Run: `open index.html`

確認項目:
1. 左サイドバーにスライダー4本・ボタン2つ・タイマー・残数が表示される
2. 初期表示: ✊が左上、✌️が右上、✋が下中央に各10人配置され、残数が各10人と表示される
3. スライダーを動かすとラベルの数値が連動する
4. スタート → 絵文字が動き回る(追跡・逃走)、タイマーがカウントダウン、捕まった絵文字が消えて残数が減る
5. 終了(時間切れ or 膠着)→ 勝者オーバーレイ(グループ名・色・残り人数)または「引き分け」が表示される
6. 実行中にリセット → 停止して初期配置に戻る
7. N=100 にしても滑らかに動く

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "UI・Canvas描画(index.html)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完了条件

- `node test.js` が全テストpass(24件)
- `index.html` をブラウザで開き、Task 8 Step 3 の確認項目7つがすべて通る
