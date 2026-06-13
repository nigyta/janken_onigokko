# 障害物機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** じゃんけん鬼ごっこの盤面にランダムな長方形障害物(進入不可・視線遮蔽・数を設定可能)を追加する。

**Architecture:** 既存の3ファイル構成を維持。`sim.js` に幾何関数(点・線分×矩形)、障害物生成、視線付き最近接探索、進入のみ禁止の軸分離スライドを追加。`index.html` にスライダーと障害物描画を追加。`obstacles = []` のデフォルト引数により既存25テストは無変更で通る。

**Tech Stack:** 素のJavaScript、Canvas 2D、node:test(既存と同じ)

**設計書:** `docs/superpowers/specs/2026-06-13-obstacles-design.md`

---

## ファイル構成(変更のみ、新規ファイルなし)

```
junken_onigokko/
├── sim.js       … 定数2つ、幾何関数3つ、Simulation拡張(障害物生成・スポーン回避・LOS・移動ブロック)
├── index.html   … スライダー追加、readParams拡張、障害物描画
└── test.js      … テスト10件追加(25 → 35件)
```

- すべてのコマンドはリポジトリルート(`/Users/tanizawa/ws_test/junken_onigokko`)で実行する
- 障害物はプレーンオブジェクト `{x, y, w, h}`。`Simulation.obstacles` 配列に保持

## 主要な設計ルール(全タスク共通)

| ルール | 内容 |
|---|---|
| 視線(LOS) | 2点間の線分がどの障害物矩形とも交差しなければ「見える」。見えない相手は追跡・逃走・捕獲の対象外 |
| 進入のみ禁止 | 「現在位置を含まない障害物に新位置が入る」移動だけブロック。脱出・内部移動は許可 |
| 軸分離スライド | 移動候補 → x成分のみ → y成分のみ の順に試し、全部ダメなら停止 |
| 後方互換 | `nearestOf`/`direction` の `obstacles` 引数はデフォルト `[]`。`params.obstacleCount` 未指定は0個 |

---

### Task 1: 幾何関数(pointInRect / segmentIntersectsRect / canSee)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の冒頭の require ブロックを以下に置き換える(新しい名前を追加):

```js
const {
  randNormal, Agent, Simulation,
  GROUPS, CATCHES, CAUGHT_BY,
  FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
  pointInRect, segmentIntersectsRect, canSee,
  OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE,
} = require('./sim.js');
```

`test.js` の末尾に以下を追加する:

```js
test('pointInRect: 境界含む内外判定', () => {
  const rect = { x: 100, y: 100, w: 50, h: 50 };
  assert.strictEqual(pointInRect(125, 125, rect), true);
  assert.strictEqual(pointInRect(100, 100, rect), true);  // 境界(左上)
  assert.strictEqual(pointInRect(150, 150, rect), true);  // 境界(右下)
  assert.strictEqual(pointInRect(99, 125, rect), false);
  assert.strictEqual(pointInRect(125, 151, rect), false);
});

test('segmentIntersectsRect: 交差・非交差の判定', () => {
  const rect = { x: 100, y: 100, w: 50, h: 50 };
  // 水平に横断する
  assert.strictEqual(segmentIntersectsRect(50, 125, 200, 125, rect), true);
  // 矩形の上を平行に通る(かすらない)
  assert.strictEqual(segmentIntersectsRect(50, 50, 200, 50, rect), false);
  // 端点が内部にある
  assert.strictEqual(segmentIntersectsRect(125, 125, 300, 300, rect), true);
  // 完全に外側(斜めでも届かない)
  assert.strictEqual(segmentIntersectsRect(0, 0, 50, 50, rect), false);
  // 角から対角へ内部を通る
  assert.strictEqual(segmentIntersectsRect(100, 100, 150, 150, rect), true);
  // 外から来て角にちょうど触れて終わる
  assert.strictEqual(segmentIntersectsRect(50, 50, 100, 100, rect), true);
  // 角の直前で止まる(触れない)
  assert.strictEqual(segmentIntersectsRect(0, 0, 99, 99, rect), false);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `pointInRect is not a function`(2件失敗、既存25件はpass)

- [ ] **Step 3: 実装を書く**

`sim.js` の定数ブロック(`const FLEE_WEIGHT = 1.5; ...` の行)の直後に追加する:

```js
const OBSTACLE_MIN_SIZE = 40;  // 障害物の辺の最小 px
const OBSTACLE_MAX_SIZE = 160; // 障害物の辺の最大 px
```

`randNormal` 関数の下(`Agent` クラスの上)に追加する:

```js
// 点が矩形内(境界含む)にあるか
function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// 線分が矩形と交差するか(Liang-Barsky法)。端点が矩形内の場合も交差とみなす
// 毎フレーム大量に呼ばれるため、配列を生成しないループ展開で実装している
function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  // 各境界(左・右・上・下)で線分のパラメータ範囲 [t0, t1] をクリップする
  // p = 境界に向かう方向成分, q = 始点から境界までの距離
  for (let i = 0; i < 4; i++) {
    let p;
    let q;
    if (i === 0) { p = -dx; q = x1 - rect.x; }              // 左境界
    else if (i === 1) { p = dx; q = rect.x + rect.w - x1; } // 右境界
    else if (i === 2) { p = -dy; q = y1 - rect.y; }         // 上境界
    else { p = dy; q = rect.y + rect.h - y1; }              // 下境界
    if (p === 0) {
      if (q < 0) return false; // 境界に平行で外側
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

// a と b の間に視線が通るか(どの障害物にも遮られない)
function canSee(a, b, obstacles) {
  for (const rect of obstacles) {
    if (segmentIntersectsRect(a.x, a.y, b.x, b.y, rect)) return false;
  }
  return true;
}
```

`sim.js` 末尾の `module.exports` を以下に置き換える:

```js
if (typeof module !== 'undefined') {
  module.exports = {
    randNormal, Agent, Simulation,
    GROUPS, CATCHES, CAUGHT_BY,
    FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_DT, FLEE_WEIGHT,
    pointInRect, segmentIntersectsRect, canSee,
    OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 27` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "幾何関数(点・線分×矩形、視線判定)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 障害物の生成とスポーン回避

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('障害物: 指定個数が盤面内・サイズ範囲内で生成される', () => {
  const sim = new Simulation({ n: 0, duration: 60, meanSpeed: 80, speedSd: 0, obstacleCount: 8 });
  assert.strictEqual(sim.obstacles.length, 8);
  for (const r of sim.obstacles) {
    assert.ok(r.w >= OBSTACLE_MIN_SIZE && r.w <= OBSTACLE_MAX_SIZE, `w=${r.w}`);
    assert.ok(r.h >= OBSTACLE_MIN_SIZE && r.h <= OBSTACLE_MAX_SIZE, `h=${r.h}`);
    assert.ok(r.x >= 0 && r.x + r.w <= FIELD_WIDTH, `x=${r.x} w=${r.w}`);
    assert.ok(r.y >= 0 && r.y + r.h <= FIELD_HEIGHT, `y=${r.y} h=${r.h}`);
  }
});

test('障害物: obstacleCount未指定なら0個(従来挙動)', () => {
  const sim = new Simulation({ n: 5, duration: 60, meanSpeed: 80, speedSd: 0 });
  assert.deepStrictEqual(sim.obstacles, []);
});

test('障害物: エージェントは障害物の外に配置される', () => {
  // 注: findSpawnPoint の最終フォールバックは理論上障害物内を返し得るが、
  // この条件(障害物カバー率 ≤ 53%)で200回の再抽選が全部外れる確率は ~10^-55 で実質ゼロ
  const sim = new Simulation({ n: 30, duration: 60, meanSpeed: 80, speedSd: 15, obstacleCount: 10 });
  for (const a of sim.agents) {
    assert.ok(!sim.obstacles.some((r) => pointInRect(a.x, a.y, r)), `(${a.x}, ${a.y})`);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — `sim.obstacles` が `undefined`(3件失敗)

- [ ] **Step 3: 実装を書く**

`sim.js` の `Simulation` コンストラクタの先頭コメントを更新する:

```js
  // params: { n, duration, meanSpeed, speedSd, obstacleCount } / rand はテスト用に注入可能
```

コンストラクタ内の `this.agents = [];` の直後に追加する:

```js
    // 障害物を先に生成(エージェント配置が障害物を避けるため)。重なりは許容
    this.obstacles = [];
    const obstacleCount = params.obstacleCount || 0;
    for (let i = 0; i < obstacleCount; i++) {
      const w = OBSTACLE_MIN_SIZE + this.rand() * (OBSTACLE_MAX_SIZE - OBSTACLE_MIN_SIZE);
      const h = OBSTACLE_MIN_SIZE + this.rand() * (OBSTACLE_MAX_SIZE - OBSTACLE_MIN_SIZE);
      this.obstacles.push({
        x: this.rand() * (FIELD_WIDTH - w),
        y: this.rand() * (FIELD_HEIGHT - h),
        w,
        h,
      });
    }
```

コンストラクタ内のスポーン位置の2行:

```js
        const x = area.x + this.rand() * area.w;
        const y = area.y + this.rand() * area.h;
```

を以下に置き換える:

```js
        const { x, y } = this.findSpawnPoint(area);
```

コンストラクタの直後(`aliveCounts` の上)にメソッドを2つ追加する:

```js
  // 障害物の外のスポーン位置を探す。
  // 担当エリアで100回 → 盤面全体で100回 → 最後の候補(進入のみ禁止ルールで脱出可能)
  findSpawnPoint(area) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 100; i++) {
      x = area.x + this.rand() * area.w;
      y = area.y + this.rand() * area.h;
      if (!this.insideAnyObstacle(x, y)) return { x, y };
    }
    for (let i = 0; i < 100; i++) {
      x = this.rand() * FIELD_WIDTH;
      y = this.rand() * FIELD_HEIGHT;
      if (!this.insideAnyObstacle(x, y)) return { x, y };
    }
    return { x, y };
  }

  // 点がいずれかの障害物の中にあるか
  insideAnyObstacle(x, y) {
    return this.obstacles.some((rect) => pointInRect(x, y, rect));
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 30` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "障害物の生成とスポーン位置の障害物回避を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 視線(LOS)の統合 — 探索・行動・捕獲

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('nearestOf: 壁の向こうの相手は見えず、見える次点を選ぶ', () => {
  const me = new Agent('gu', 0, 125, 10);
  const hidden = new Agent('choki', 200, 125, 10);  // 壁の向こう(近い)
  const visible = new Agent('choki', 0, 400, 10);   // 壁なし(遠い)
  const wall = { x: 100, y: 100, w: 50, h: 50 };
  assert.strictEqual(me.nearestOf([me, hidden, visible], 'choki', [wall]), visible);
  // 全員壁の向こうなら null
  assert.strictEqual(me.nearestOf([me, hidden], 'choki', [wall]), null);
});

test('direction: 見える相手がいなければ null(停止)', () => {
  const me = new Agent('gu', 0, 125, 10);
  const prey = new Agent('choki', 200, 125, 10);
  const threat = new Agent('pa', 220, 125, 10);
  const wall = { x: 100, y: 100, w: 50, h: 50 };
  assert.strictEqual(me.direction([me, prey, threat], [wall]), null);
});

test('捕獲: 捕獲半径内でも壁が間にあれば不成立', () => {
  const sim = makeEmptySim();
  sim.obstacles = [{ x: 104, y: 50, w: 2, h: 100 }]; // 2人の間の薄い壁
  const hunter = new Agent('gu', 100, 100, 0);
  const prey = new Agent('choki', 110, 100, 0); // 距離10 < 16 だが壁越し
  sim.agents.push(hunter, prey);
  sim.tick(0.001);
  assert.strictEqual(prey.alive, true);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 3件失敗(`nearestOf` が壁を無視して `hidden` を返す、`direction` が非null、`prey.alive` が `false`)

- [ ] **Step 3: 実装を書く**

`Agent.nearestOf` を以下に置き換える:

```js
  // agents の中から、指定グループの「見える」最近接の生存者を返す(いなければ null)
  // 枝刈り: 現在の最良候補より近い相手のみ視線判定を行う
  nearestOf(agents, group, obstacles = []) {
    let nearest = null;
    let minDist = Infinity;
    for (const a of agents) {
      if (a === this || !a.alive || a.group !== group) continue;
      const d = this.distanceTo(a);
      if (d >= minDist) continue;
      if (!canSee(this, a, obstacles)) continue;
      minDist = d;
      nearest = a;
    }
    return nearest;
  }
```

`Agent.direction` の先頭3行を以下に置き換える(本体の重み計算は変更しない):

```js
  direction(agents, obstacles = []) {
    const prey = this.nearestOf(agents, CATCHES[this.group], obstacles);
    const threat = this.nearestOf(agents, CAUGHT_BY[this.group], obstacles);
```

`Simulation.tick` の移動ループ内の呼び出しを変更する:

```js
      const dir = agent.direction(this.agents, this.obstacles);
```

`Simulation.tick` の捕獲判定の内側2行:

```js
        if (CATCHES[hunter.group] !== prey.group) continue;
        if (hunter.distanceTo(prey) < CAPTURE_RADIUS) caught.add(prey);
```

を以下に置き換える:

```js
        if (CATCHES[hunter.group] !== prey.group) continue;
        if (hunter.distanceTo(prey) >= CAPTURE_RADIUS) continue;
        if (!canSee(hunter, prey, this.obstacles)) continue;
        caught.add(prey);
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 33` `# fail 0`(既存テストは `obstacles = []` デフォルトのため影響なし)

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "視線判定を探索・行動・捕獲に統合(壁越しは認識・捕獲不可)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 移動の障害物ブロック(進入のみ禁止+軸分離スライド)

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('blockedMove: 進入のみ禁止(今いる障害物からの脱出・内部移動は許可)', () => {
  const sim = makeEmptySim();
  sim.obstacles = [
    { x: 80, y: 80, w: 40, h: 40 },
    { x: 200, y: 80, w: 40, h: 40 },
  ];
  const inside = new Agent('gu', 100, 100, 10); // 1つ目の障害物の中
  assert.strictEqual(sim.blockedMove(inside, 105, 100), false); // 内部移動は許可
  assert.strictEqual(sim.blockedMove(inside, 60, 100), false);  // 脱出は許可
  assert.strictEqual(sim.blockedMove(inside, 210, 100), true);  // 別の障害物への進入は禁止
  const outside = new Agent('gu', 50, 100, 10);
  assert.strictEqual(sim.blockedMove(outside, 100, 100), true); // 外からの進入は禁止
  assert.strictEqual(sim.blockedMove(outside, 55, 100), false); // 通常移動は許可
});

test('移動: 障害物に進入せず、壁に沿ってスライドする', () => {
  const sim = makeEmptySim();
  // x ∈ [40, 92], y ∈ [50, 150] の壁
  sim.obstacles = [{ x: 40, y: 50, w: 52, h: 100 }];
  const runner = new Agent('gu', 100, 100, 100);
  const threat = new Agent('pa', 180, 160, 0); // 視線は通る(壁は x≤92 のみ)
  sim.agents.push(runner, threat);
  // 逃走方向 = normalize((-80, -60)) = (-0.8, -0.6)。dt=0.1, speed=100 → 候補 (92, 94)
  sim.tick(0.1);
  // (92, 94) は壁の中 → x成分(92,100)も壁の中 → y成分(100,94)だけ通る(スライド)
  assert.strictEqual(runner.x, 100);
  assert.ok(Math.abs(runner.y - 94) < 1e-9, `y=${runner.y}`);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 2件失敗(`sim.blockedMove is not a function`、スライドテストは runner が壁の中 (92, 94) に進入)

- [ ] **Step 3: 実装を書く**

`Simulation` の `insideAnyObstacle` メソッドの下に追加する:

```js
  // (nx, ny) への移動がブロックされるか。
  // 現在位置を含む障害物は判定免除(進入のみ禁止、脱出は常に許可)
  blockedMove(agent, nx, ny) {
    return this.obstacles.some(
      (rect) => pointInRect(nx, ny, rect) && !pointInRect(agent.x, agent.y, rect)
    );
  }
```

`Simulation.tick` の移動ループ:

```js
    // 移動(壁の内側にクランプ)
    for (const agent of this.agents) {
      if (!agent.alive) continue;
      const dir = agent.direction(this.agents, this.obstacles);
      if (!dir) continue;
      agent.x = Math.min(Math.max(agent.x + dir.x * agent.speed * dt, 0), FIELD_WIDTH);
      agent.y = Math.min(Math.max(agent.y + dir.y * agent.speed * dt, 0), FIELD_HEIGHT);
    }
```

を以下に置き換える:

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

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `# pass 35` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "障害物への進入禁止と軸分離スライド移動を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: UI(スライダー・障害物描画)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: スライダーを追加する**

`index.html` のサイドバー内、`sdSlider` の `<div>` ブロック:

```html
  <div>
    <label>速度の標準偏差: <span id="sdValue">15</span> px/秒</label>
    <input type="range" id="sdSlider" min="0" max="100" value="15">
  </div>
```

の直後に以下を追加する:

```html
  <div>
    <label>障害物の数: <span id="obsValue">5</span> 個</label>
    <input type="range" id="obsSlider" min="0" max="15" value="5">
  </div>
```

- [ ] **Step 2: スライダーの値表示と readParams を拡張する**

`sliderPairs` 配列に1行追加する:

```js
const sliderPairs = [
  ['nSlider', 'nValue'],
  ['durSlider', 'durValue'],
  ['speedSlider', 'speedValue'],
  ['sdSlider', 'sdValue'],
  ['obsSlider', 'obsValue'],
];
```

`readParams` を以下に置き換える:

```js
function readParams() {
  return {
    n: Number($('nSlider').value),
    duration: Number($('durSlider').value),
    meanSpeed: Number($('speedSlider').value),
    speedSd: Number($('sdSlider').value),
    obstacleCount: Number($('obsSlider').value),
  };
}
```

- [ ] **Step 3: 障害物を描画する**

`draw` 関数の `ctx.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);` の直後に以下を追加する(エージェントより先に描く):

```js
  // 障害物
  ctx.fillStyle = '#2c2c54';
  ctx.strokeStyle = '#44446e';
  ctx.lineWidth = 1;
  for (const r of sim.obstacles) {
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
```

- [ ] **Step 4: 機械的な整合性チェックとテスト**

1. インラインスクリプトを抜き出して `node --check` で構文確認
2. 参照IDの存在確認(obsSlider / obsValue)
3. Run: `node test.js` → Expected: `# pass 35` `# fail 0`

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "障害物の数スライダーと障害物描画を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 手動確認(コントローラー/ユーザーが実施)**

Run: `open index.html`

1. 「障害物の数」スライダー(0〜15、初期5)が表示され、ラベルが連動する
2. リセット/スタートで暗色の長方形がランダムに配置される(毎回変わる)
3. エージェントが障害物に入らず、縁に沿って滑る
4. 壁の向こうの相手に反応しない(壁際に逃げ込むと追跡が外れる)
5. 障害物0個なら従来どおりの挙動
6. N=100・障害物15個でも滑らかに動く

---

## 完了条件

- `node test.js` が全テストpass(35件)
- 手動確認6項目がすべて通る
