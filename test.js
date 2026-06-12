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
  // 逃走の重み 1.5 が追跡の 1.0 に勝ち、-x 方向に逃げる
  assert.ok(dir.x < 0, `dir.x=${dir.x}`);
});

test('direction: 獲物も脅威もいなければ null(その場で停止)', () => {
  const me = new Agent('gu', 100, 100, 10);
  assert.strictEqual(me.direction([me]), null);
});
