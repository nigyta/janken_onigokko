# ランダム脱出機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** このフレームで1ピクセルも動けなかったエージェント(障害物の角・盤面の角に挟まれた、または相手が見えず方向が無い)を、ランダムな方向に動かして膠着を脱出させる。

**Architecture:** `Agent` に持続するさまよう向き `wanderAngle` を追加し、`Simulation.tick` の移動ループを「移動前位置を記録 → ターゲット追従を試す → 位置が変わっていなければ `wanderMove` でランダム移動」に変更する。`wanderMove` は `this.rand` を使い最大 `WANDER_TRIES` 回、空いている向きを探す。

**Tech Stack:** 素のJavaScript、node:test(既存と同じ)

**設計書:** `docs/superpowers/specs/2026-06-13-random-escape-design.md`

---

## ファイル構成(変更のみ、新規ファイルなし)

```
junken_onigokko/
├── sim.js   … 定数 WANDER_TRIES、Agent.wanderAngle、Simulation.wanderMove、tick移動ループ改修
└── test.js  … テスト4件追加(36 → 40件)
```

すべてのコマンドはリポジトリルート(`/Users/tanizawa/ws_test/junken_onigokko`)で実行する。

## 現状の対象コード(参考)

`Simulation.tick` の移動ループは現在こうなっている(置き換え対象):

```js
    // 移動(壁の内側にクランプ、障害物には進入不可)
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      const dir = agent.direction(this.agents, this.obstacles);
      if (!dir) continue;
      const nx = Math.min(Math.max(agent.x + dir.x * agent.speed * dt, 0), FIELD_WIDTH);
      const ny = Math.min(Math.max(agent.y + dir.y * agent.speed * dt, 0), FIELD_HEIGHT);
      // 軸分離スライド: そのまま → x のみ → y のみ の順に試し、全部ダメなら停止
      if (!this.blockedMove(agent, nx, ny)) {
        agent.x = nx;
        agent.y = ny;
      } else if (!this.blockedMove(agent, nx, agent.y)) {
        agent.x = nx;
      } else if (!this.blockedMove(agent, agent.x, ny)) {
        agent.y = ny;
      }
    }
```

`Agent` コンストラクタは現在こう:

```js
  constructor(group, x, y, speed) {
    this.group = group;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.alive = true;
  }
```

---

### Task 1: wanderAngle と WANDER_TRIES の追加(土台)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の冒頭の require ブロックに `WANDER_TRIES` を追加する。現在の:

```js
  pointInRect, segmentIntersectsRect, canSee,
  OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE,
} = require('./sim.js');
```

を以下に置き換える:

```js
  pointInRect, segmentIntersectsRect, canSee,
  OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES,
} = require('./sim.js');
```

`test.js` の末尾に以下を追加する:

```js
test('Agent: 新規エージェントの wanderAngle は null', () => {
  const a = new Agent('gu', 0, 0, 10);
  assert.strictEqual(a.wanderAngle, null);
});

test('WANDER_TRIES が正の整数として公開されている', () => {
  assert.ok(Number.isInteger(WANDER_TRIES) && WANDER_TRIES > 0, `WANDER_TRIES=${WANDER_TRIES}`);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 2件失敗(`a.wanderAngle` が `undefined`、`WANDER_TRIES` が `undefined`)

- [ ] **Step 3: 実装を書く**

`sim.js` の定数ブロックの `const OBSTACLE_MAX_SIZE = 160; ...` の行の直後に追加する:

```js
const WANDER_TRIES = 8; // 詰まったときにランダム方向を探す最大試行回数
```

`Agent` コンストラクタの `this.alive = true;` の直後に追加する:

```js
    this.wanderAngle = null; // 詰まったときにさまよう向き(ラジアン)。未設定は null
```

`sim.js` 末尾の `module.exports` の中、`OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE,` の行を以下に置き換える:

```js
    OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES,
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 38` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "wanderAngleとWANDER_TRIESを追加(ランダム脱出の土台)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: wanderMove と tick 移動ループの改修

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する(`makeEmptySim` は定義済みヘルパー):

```js
// rand を注入できる Simulation を作るヘルパー(n:0 の空シミュレーション)
function makeSimWithRand(rand) {
  return new Simulation({ n: 0, duration: 60, meanSpeed: 80, speedSd: 0 }, rand);
}

test('wanderMove: 相手が見えないエージェントもランダムに動く', () => {
  // rand は常に 0 を返す → wanderAngle = 0(=+x 方向)
  const sim = makeSimWithRand(() => 0);
  const a = new Agent('gu', 100, 100, 50); // 相手なし(単独)→ 方向なし
  sim.agents.push(a);
  sim.tick(0.1); // +x へ 50×0.1 = 5px 進むはず
  assert.ok(Math.abs(a.x - 105) < 1e-9, `x=${a.x}`);
  assert.ok(Math.abs(a.y - 100) < 1e-9, `y=${a.y}`);
});

test('wanderMove: 速度0のエージェントは動かない(回帰防止)', () => {
  const sim = makeSimWithRand(() => 0);
  const a = new Agent('gu', 100, 100, 0); // 速度0
  sim.agents.push(a);
  sim.tick(0.1);
  assert.strictEqual(a.x, 100);
  assert.strictEqual(a.y, 100);
});

test('wanderMove: 角で詰まったエージェントが別方向に脱出する', () => {
  // rand 常に 0.5 → 引き直すと角度 0.5×2π=π(-x 方向)
  const sim = makeSimWithRand(() => 0.5);
  // エージェントの右(+x)に壁。左は開いている
  sim.obstacles = [{ x: 110, y: 50, w: 100, h: 100 }];
  const a = new Agent('gu', 105, 100, 50);
  a.wanderAngle = 0; // 既に +x 向き(壁にぶつかる)
  sim.agents.push(a);
  sim.tick(0.1);
  // 試行0: +x(角度0)は壁(x≥110)に阻まれ引き直し → 試行1: 角度π(-x)で 5px 脱出
  assert.ok(a.x < 105, `x=${a.x}`); // 左に動いた
  assert.ok(Math.abs(a.y - 100) < 1e-9, `y=${a.y}`);
});

test('wanderMove: 盤面の角に押し付けられたエージェントも動く', () => {
  // rand 常に 0.5 → 角度 π(-x 方向)。盤面右下の角に居て -x なら盤面内に動ける
  const sim = makeSimWithRand(() => 0.5);
  const prey = new Agent('choki', 1000, 700, 0); // 盤面の外(右下方向)に獲物 → 角へ引かれる
  const a = new Agent('gu', FIELD_WIDTH, FIELD_HEIGHT, 50); // 盤面右下の角(800,600)
  sim.agents.push(a, prey);
  // a は外の獲物へ向かおうとするが盤面端クランプで動けない → wanderMove 発動
  sim.tick(0.1);
  // -x 方向に 5px 動く(y は端でクランプ継続)
  assert.ok(a.x < FIELD_WIDTH, `x=${a.x}`);
  assert.ok(Math.abs(a.y - FIELD_HEIGHT) < 1e-9, `y=${a.y}`);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 4件中少なくとも3件が失敗(`wanderMove` 未実装のため、相手が見えない/角で詰まったエージェントが動かない)。速度0のテストは実装前から通る

- [ ] **Step 3: 実装を書く**

`sim.js` の `Simulation` の `blockedMove` メソッドの下に `wanderMove` メソッドを追加する:

```js
  // 詰まったエージェントをランダムな方向へ動かす。
  // 持続する wanderAngle 方向をまず試し、ブロックされたら引き直す(最大 WANDER_TRIES 回)。
  // 動ける向きが見つかれば移動、見つからなければその場に留まる
  wanderMove(agent, dt) {
    for (let attempt = 0; attempt < WANDER_TRIES; attempt++) {
      if (agent.wanderAngle === null) {
        agent.wanderAngle = this.rand() * 2 * Math.PI;
      }
      const nx = Math.min(Math.max(agent.x + Math.cos(agent.wanderAngle) * agent.speed * dt, 0), FIELD_WIDTH);
      const ny = Math.min(Math.max(agent.y + Math.sin(agent.wanderAngle) * agent.speed * dt, 0), FIELD_HEIGHT);
      if ((nx !== agent.x || ny !== agent.y) && !this.blockedMove(agent, nx, ny)) {
        agent.x = nx;
        agent.y = ny;
        return;
      }
      // この向きでは動けない → 引き直して次の試行へ
      agent.wanderAngle = this.rand() * 2 * Math.PI;
    }
  }
```

`Simulation.tick` の移動ループ全体:

```js
    // 移動(壁の内側にクランプ、障害物には進入不可)
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      const dir = agent.direction(this.agents, this.obstacles);
      if (!dir) continue;
      const nx = Math.min(Math.max(agent.x + dir.x * agent.speed * dt, 0), FIELD_WIDTH);
      const ny = Math.min(Math.max(agent.y + dir.y * agent.speed * dt, 0), FIELD_HEIGHT);
      // 軸分離スライド: そのまま → x のみ → y のみ の順に試し、全部ダメなら停止
      if (!this.blockedMove(agent, nx, ny)) {
        agent.x = nx;
        agent.y = ny;
      } else if (!this.blockedMove(agent, nx, agent.y)) {
        agent.x = nx;
      } else if (!this.blockedMove(agent, agent.x, ny)) {
        agent.y = ny;
      }
    }
```

を以下に置き換える:

```js
    // 移動(壁の内側にクランプ、障害物には進入不可)
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      const ox = agent.x;
      const oy = agent.y;
      const dir = agent.direction(this.agents, this.obstacles);
      if (dir) {
        const nx = Math.min(Math.max(agent.x + dir.x * agent.speed * dt, 0), FIELD_WIDTH);
        const ny = Math.min(Math.max(agent.y + dir.y * agent.speed * dt, 0), FIELD_HEIGHT);
        // 軸分離スライド: そのまま → x のみ → y のみ の順に試し、全部ダメなら停止
        if (!this.blockedMove(agent, nx, ny)) {
          agent.x = nx;
          agent.y = ny;
        } else if (!this.blockedMove(agent, nx, agent.y)) {
          agent.x = nx;
        } else if (!this.blockedMove(agent, agent.x, ny)) {
          agent.y = ny;
        }
      }
      // このフレームで1ピクセルも動けなかった(角に挟まれた / 盤面端 / 相手が見えない)
      // 場合はランダムな方向に動いて膠着を脱出する
      if (agent.x === ox && agent.y === oy) {
        this.wanderMove(agent, dt);
      }
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 42` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "詰まったエージェントのランダム脱出(wanderMove)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 手動確認(コントローラー/ユーザーが実施)**

Run: `open index.html`

1. 障害物を多め(10〜15個)にしてスタートし、障害物の凹んだ角に挟まったエージェントが固まらず、向きを変えて脱出する
2. 相手が壁の裏に隠れて見えないエージェントが、その場で止まらず動き回って探索する
3. 障害物0個でも従来どおり自然に動く(常に相手が見えるので wander はほぼ発動しない)

---

## 完了条件

- `node test.js` が全テストpass(42件)
- 手動確認3項目がすべて通る
