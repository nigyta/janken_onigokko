# 人数推移グラフ機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グー・チョキ・パー各グループの生存人数の時間推移を、メイン盤面の下に自前 Canvas で折れ線グラフとしてリアルタイム表示する。

**Architecture:** 履歴データは `Simulation`(ロジック側)に持たせてテスト可能にする。`Simulation` は 0.5 秒ごと(+終了時に必ず1点)に `{ t, gu, choki, pa }` を `history` 配列へ記録する。`index.html` 側はメイン canvas の下に新しいグラフ canvas を縦積みし、`drawGraph(sim)` で `history` を折れ線に描く。

**Tech Stack:** 素のJavaScript、Canvas 2D、node:test(既存と同じ)。外部ライブラリ・ビルドなし。

**設計書:** `docs/superpowers/specs/2026-06-13-count-graph-design.md`

---

## ファイル構成(変更のみ、新規ファイルなし)

```
janken_onigokko/
├── sim.js     … 定数 SAMPLE_INTERVAL、Simulation.elapsed/nextSampleAt/history、pushSample、tick のサンプリング、export 追加
├── index.html … グラフ canvas 追加、レイアウト(縦積み + fieldWrap)、drawGraph、loop/reset への配線
└── test.js    … テスト5件追加(42 → 47件。Task 1 で2件、Task 2 で3件)
```

すべてのコマンドはリポジトリルート(`/Users/tanizawa/ws_test/janken_onigokko`)で実行する。

## 現状の対象コード(参考)

`Simulation` コンストラクタの冒頭(変更箇所):

```js
  constructor(params, rand = Math.random) {
    this.params = params;
    this.rand = rand;
    this.timeLeft = params.duration;
    this.finished = false;
    this.winner = null; // グループ識別子 | 'draw' | null(進行中)
    this.agents = [];
```

コンストラクタは最後に「3グループを離れた3エリアに配置」するループで終わる(末尾に開始点記録を足す)。

`Simulation.tick` の冒頭と末尾(変更箇所):

```js
  tick(dt) {
    if (this.finished) return;
    dt = Math.min(dt, MAX_DT);
    this.timeLeft -= dt;
    // ... 移動 → 捕獲判定 ...
    // 終了判定: 時間切れ、または膠着(残存グループが1つ以下)
    const counts = this.aliveCounts();
    const survivingGroups = GROUPS.filter((g) => counts[g] > 0);
    if (this.timeLeft <= 1e-9) this.timeLeft = 0; // 浮動小数点の減算残差を吸収
    if (this.timeLeft <= 0 || survivingGroups.length <= 1) {
      this.finished = true;
      const max = Math.max(counts.gu, counts.choki, counts.pa);
      const winners = GROUPS.filter((g) => counts[g] === max);
      this.winner = winners.length === 1 ? winners[0] : 'draw';
    }
  }
```

`sim.js` 末尾の `module.exports`(変更箇所):

```js
  module.exports = {
    randNormal, Agent, Simulation,
    GROUPS, CATCHES, CAUGHT_BY,
    FIELD_WIDTH, FIELD_HEIGHT, CAPTURE_RADIUS, MIN_SPEED, MAX_SPEED, MAX_DT, FLEE_WEIGHT,
    pointInRect, segmentIntersectsRect, canSee,
    OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES,
  };
```

`index.html` の `#board`(変更箇所):

```html
<div id="board">
  <canvas id="field" width="800" height="600"></canvas>
  <div id="overlay"></div>
</div>
```

`index.html` の関連 CSS(変更箇所):

```css
  #board {
    flex: 1; display: flex; align-items: center; justify-content: center;
    position: relative; padding: 16px;
  }
  canvas {
    background: #0f0f1a; border-radius: 8px;
    max-width: 100%; max-height: 100%;
  }
```

`index.html` の `loop()` と `reset()`(配線箇所):

```js
  sim.tick(dt);
  draw(sim);
  updateStatus();
```

```js
  sim = new Simulation(readParams());
  draw(sim);
  updateCounts();
  $('timer').textContent = '⏱ ─'; // 開始前はタイマーを表示しない
```

---

### Task 1: 履歴データの土台(SAMPLE_INTERVAL・history・pushSample)

`Simulation` に履歴フィールドと開始点記録を追加する。tick のサンプリングは Task 2。

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` 冒頭の require ブロックの `OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES,` の行を以下に置き換える:

```js
  OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES, SAMPLE_INTERVAL,
```

`test.js` の末尾に以下を追加する:

```js
test('SAMPLE_INTERVAL が正の数として公開されている', () => {
  assert.ok(typeof SAMPLE_INTERVAL === 'number' && SAMPLE_INTERVAL > 0, `SAMPLE_INTERVAL=${SAMPLE_INTERVAL}`);
});

test('Simulation: 初期 history は開始時点1点(t=0、全グループ n 人)', () => {
  const sim = new Simulation({ n: 5, duration: 60, meanSpeed: 80, speedSd: 0, obstacleCount: 0 });
  assert.strictEqual(sim.history.length, 1);
  assert.deepStrictEqual(sim.history[0], { t: 0, gu: 5, choki: 5, pa: 5 });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 2件失敗(`SAMPLE_INTERVAL` が `undefined`、`sim.history` が `undefined`)

- [ ] **Step 3: 実装を書く**

`sim.js` の定数 `const WANDER_TRIES = 8; ...` の行の直後に追加する:

```js
const SAMPLE_INTERVAL = 0.5; // 人数推移グラフのサンプリング間隔(秒)
```

`Simulation` コンストラクタの `this.winner = null; ...` の行の直後に追加する:

```js
    this.elapsed = 0;                    // 経過時間(秒)。人数推移のサンプリングに使う
    this.nextSampleAt = SAMPLE_INTERVAL; // 次にサンプルを取る経過時刻(秒)
    this.history = [];                   // 人数推移 [{ t, gu, choki, pa }]。末尾で開始点を記録
```

`Simulation` コンストラクタの**末尾**(エージェント配置ループの閉じ `}` の直後、コンストラクタの閉じ `}` の直前)に追加する:

```js
    this.pushSample(); // 開始時点(t=0、全グループ params.n 人)を記録
```

`Simulation` の `aliveCounts()` メソッドの直後に `pushSample` メソッドを追加する:

```js
  // 現在の経過時刻と生存人数を人数推移の履歴に1点追加する
  pushSample() {
    const counts = this.aliveCounts();
    this.history.push({ t: this.elapsed, gu: counts.gu, choki: counts.choki, pa: counts.pa });
  }
```

`sim.js` 末尾の `module.exports` の `OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES,` の行を以下に置き換える:

```js
    OBSTACLE_MIN_SIZE, OBSTACLE_MAX_SIZE, WANDER_TRIES, SAMPLE_INTERVAL,
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `ℹ pass 44` `ℹ fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "SAMPLE_INTERVALと人数推移history(開始点記録)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: tick のサンプリングロジック

`tick` で経過時間を加算し、移動・捕獲・終了判定の**後**に履歴を記録する(間隔ごと+終了時)。

**Files:**
- Modify: `sim.js`
- Modify: `test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test.js` の末尾に以下を追加する:

```js
test('tick: SAMPLE_INTERVAL ごとに history が1点ずつ増える', () => {
  // n:0 で空シミュレーションを作り、捕まえ合わない2体を離して置く(速度0で動かない)
  const sim = new Simulation({ n: 0, duration: 60, meanSpeed: 0, speedSd: 0, obstacleCount: 0 }, () => 0.5);
  sim.agents.push(new Agent('gu', 100, 100, 0));
  sim.agents.push(new Agent('choki', 700, 500, 0));
  assert.strictEqual(sim.history.length, 1); // 開始点のみ
  for (let i = 0; i < 4; i++) sim.tick(0.1); // 経過 ~0.4s < 0.5 → 増えない
  assert.strictEqual(sim.history.length, 1, `0.4s後: len=${sim.history.length}`);
  for (let i = 0; i < 2; i++) sim.tick(0.1); // 経過 ~0.6s → 0.5 を1回だけ跨ぐ
  assert.strictEqual(sim.history.length, 2, `0.6s後: len=${sim.history.length}`);
  const s = sim.history[1];
  assert.ok(s.t >= 0.49 && s.t <= 0.65, `t=${s.t}`);
  assert.strictEqual(s.gu + s.choki + s.pa, 2); // gu1 + choki1(捕獲なし)
});

test('tick: 終了時に最終点が記録される(間隔の途中でも)', () => {
  const sim = new Simulation({ n: 1, duration: 0.05, meanSpeed: 0, speedSd: 0, obstacleCount: 0 }, () => 0.5);
  assert.strictEqual(sim.history.length, 1); // 開始点のみ
  sim.tick(0.1); // duration 0.05 を超過 → このtickで終了
  assert.strictEqual(sim.finished, true);
  assert.strictEqual(sim.history.length, 2, `len=${sim.history.length}`); // 開始 + 終了
  const last = sim.history[1];
  assert.ok(last.t > 0 && last.t < SAMPLE_INTERVAL, `t=${last.t}`); // 0.1s < 0.5s でも記録される
});

test('history: 合計は単調非増加で、開始時は 3n', () => {
  const sim = new Simulation({ n: 8, duration: 5, meanSpeed: 120, speedSd: 0, obstacleCount: 0 });
  let guard = 0;
  while (!sim.finished && guard++ < 100000) sim.tick(0.1); // 終了まで回す
  assert.ok(sim.history.length >= 2, `len=${sim.history.length}`);
  const first = sim.history[0];
  assert.strictEqual(first.gu + first.choki + first.pa, 24); // 3 × 8
  let prev = Infinity;
  for (const s of sim.history) {
    const total = s.gu + s.choki + s.pa;
    assert.ok(total <= prev, `total ${total} > prev ${prev} (t=${s.t})`); // 人は減る一方
    prev = total;
  }
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node test.js`
Expected: FAIL — 追加した3件すべて失敗(tick がまだ記録しないため `history.length` が増えず、間隔サンプル・終了点・`length >= 2` の各アサートが落ちる)

- [ ] **Step 3: 実装を書く**

`Simulation.tick` の `this.timeLeft -= dt;` の行の直後に追加する:

```js
    this.elapsed += dt;
```

`Simulation.tick` の末尾、終了判定の `if (this.timeLeft <= 0 || ...) { ... }` ブロックの閉じ `}` の直後(メソッドの閉じ `}` の直前)に追加する:

```js
    // 人数推移を記録する(移動・捕獲・終了判定の後 = この tick の結果を反映)
    if (this.finished) {
      this.pushSample(); // 終了点は間隔に関係なく必ず記録(末端が欠けない)
    } else {
      // SAMPLE_INTERVAL ごとに記録。while で、万一1tickが複数間隔をまたいでも漏らさない
      while (this.elapsed >= this.nextSampleAt) {
        this.pushSample();
        this.nextSampleAt += SAMPLE_INTERVAL;
      }
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node test.js`
Expected: `ℹ pass 47` `ℹ fail 0`

- [ ] **Step 5: コミット**

```bash
git add sim.js test.js
git commit -m "tickに人数推移のサンプリング(間隔ごと+終了時)を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: グラフ Canvas の描画と配線(UI)

メイン canvas の下にグラフ canvas を縦積みし、`drawGraph(sim)` で折れ線を描く。overlay は盤面のみに重ねる。

**Files:**
- Modify: `index.html`

このタスクは Canvas 描画のため node テストは追加しない(既存方針どおり UI は手動確認)。

- [ ] **Step 1: HTML — グラフ canvas を追加し、盤面を fieldWrap で包む**

`index.html` の `#board` ブロックを以下に置き換える:

```html
<div id="board">
  <div id="fieldWrap">
    <canvas id="field" width="800" height="600"></canvas>
    <div id="overlay"></div>
  </div>
  <canvas id="graph" width="800" height="160"></canvas>
</div>
```

- [ ] **Step 2: CSS — 縦積みレイアウトと fieldWrap**

`index.html` の `#board` の CSS ルールを以下に置き換える:

```css
  #board {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    padding: 16px;
  }
  #fieldWrap { position: relative; }
```

同じく `canvas` の CSS ルールを以下に置き換える(`max-height: 100%` を外し、ブロック表示にする):

```css
  canvas {
    display: block;
    background: #0f0f1a; border-radius: 8px;
    max-width: 100%;
  }
```

(`#overlay` の CSS はそのまま。親が `#board` から `#fieldWrap` に変わるため、`inset: 0` で盤面だけを覆うようになる)

- [ ] **Step 3: JS — グラフ用コンテキストと定数を取得**

`index.html` の `const ctx = canvas.getContext('2d');` の行の直後に追加する:

```js
const graphCanvas = document.getElementById('graph');
const gctx = graphCanvas.getContext('2d');
const GRAPH_W = graphCanvas.width;   // 800
const GRAPH_H = graphCanvas.height;  // 160
const GRAPH_PAD = 28;                // 軸ラベル用の余白 px
```

- [ ] **Step 4: JS — drawGraph を追加**

`index.html` の `draw(sim)` 関数(`}` で閉じる)の直後に追加する:

```js
function drawGraph(sim) {
  gctx.clearRect(0, 0, GRAPH_W, GRAPH_H);

  const n = sim.params.n;
  const duration = sim.params.duration;
  const left = GRAPH_PAD;
  const top = GRAPH_PAD;
  const plotW = GRAPH_W - GRAPH_PAD * 2;
  const plotH = GRAPH_H - GRAPH_PAD * 2;
  const right = left + plotW;
  const bottom = top + plotH;

  // 軸(左=y軸、下=x軸)
  gctx.strokeStyle = '#2c2c54';
  gctx.lineWidth = 1;
  gctx.beginPath();
  gctx.moveTo(left, top);
  gctx.lineTo(left, bottom);
  gctx.lineTo(right, bottom);
  gctx.stroke();

  // 目盛りラベル
  gctx.fillStyle = '#888';
  gctx.font = '11px sans-serif';
  gctx.textAlign = 'right';
  gctx.textBaseline = 'middle';
  gctx.fillText(String(n), left - 6, top);    // y上端 = 初期人数 n
  gctx.fillText('0', left - 6, bottom);        // y下端 = 0
  gctx.textAlign = 'center';
  gctx.textBaseline = 'top';
  gctx.fillText('0s', left, bottom + 4);              // x左端
  gctx.fillText(duration + 's', right, bottom + 4);   // x右端

  if (n <= 0 || duration <= 0) return; // 0除算防止(折れ線は描かない)

  // グー・チョキ・パーの3本の折れ線
  for (const group of GROUPS) {
    gctx.strokeStyle = COLOR[group];
    gctx.lineWidth = 2;
    gctx.beginPath();
    sim.history.forEach((s, i) => {
      const tx = Math.min(s.t / duration, 1);             // 終了点が duration を僅かに超えても右端でクランプ
      const ry = Math.max(0, Math.min(1, s[group] / n));  // 念のため [0,1] にクランプ
      const x = left + tx * plotW;
      const y = top + (1 - ry) * plotH;                   // 上が多い
      if (i === 0) gctx.moveTo(x, y);
      else gctx.lineTo(x, y);
    });
    gctx.stroke();
  }
}
```

- [ ] **Step 5: JS — loop() と reset() から drawGraph を呼ぶ**

`index.html` の `loop()` 内の `draw(sim);` の行の直後に追加する:

```js
  drawGraph(sim);
```

`index.html` の `reset()` 内の `draw(sim);` の行の直後に追加する:

```js
  drawGraph(sim);
```

- [ ] **Step 6: コミット**

```bash
git add index.html
git commit -m "グー・チョキ・パー人数推移の折れ線グラフを盤面下に表示

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: 手動確認(コントローラー/ユーザーが実施)**

Run: `open index.html`

1. メイン盤面の下に横長のグラフ領域が表示される(初期は軸と目盛り `0 / n / 0s / duration s` のみ。履歴1点では線は描かれない)
2. スタート → グー(赤)・チョキ(緑)・パー(青)の3本の折れ線がリアルタイムに右へ伸び、捕まって人数が減ると下がる
3. グラフの色がサイドバーの人数表示の色と一致している
4. 終了 → 勝者バナーがメイン盤面に重なるが、**グラフは隠れず**最終状態まで見える
5. リセット → グラフが初期状態(軸と目盛りのみ)に戻る
6. 盤面とグラフが画面内に収まっている(縦に大きいウィンドウ推奨)

---

## 完了条件

- `node test.js` が全テスト pass(47件)
- 手動確認6項目がすべて通る
