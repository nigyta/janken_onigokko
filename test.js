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

test('捕獲: 捕獲半径より遠ければ捕まらない', () => {
  const sim = makeEmptySim();
  const hunter = new Agent('gu', 100, 100, 0);
  const prey = new Agent('choki', 120, 100, 0); // 距離20 >= 16
  sim.agents.push(hunter, prey);
  sim.tick(0.001);
  assert.strictEqual(prey.alive, true);
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
