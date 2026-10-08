/* eslint-disable @typescript-eslint/no-var-requires */

const FEATURE_NAMES = [
  'trend1m',
  'trend5m',
  'trend15m',
  'rsiBalance',
  'momentum1m',
  'momentum5m',
  'atrVsSpread',
  'discount',
  'liquidity',
  'setupBias',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
  const x = clamp(value, -20, 20);
  return 1 / (1 + Math.exp(-x));
}

function defaultModel() {
  return {
    version: 1,
    bias: -0.10,
    weights: {
      trend1m: 0.55,
      trend5m: 0.75,
      trend15m: 0.80,
      rsiBalance: 0.35,
      momentum1m: 0.70,
      momentum5m: 0.65,
      atrVsSpread: 0.45,
      discount: 0.30,
      liquidity: 0.20,
      setupBias: 0.25,
    },
    tradesLearned: 0,
    winsLearned: 0,
    lossesLearned: 0,
    lastUpdateAt: 0,
    rollingReward: 0,
  };
}

function ensureModel(candidate) {
  const base = defaultModel();
  if (!candidate || typeof candidate !== 'object') return base;
  return {
    ...base,
    ...candidate,
    weights: { ...base.weights, ...(candidate.weights || {}) },
  };
}

function predict(modelInput, features) {
  const model = ensureModel(modelInput);
  let z = Number(model.bias || 0);
  for (const name of FEATURE_NAMES) {
    z += Number(model.weights[name] || 0) * clamp(Number(features[name] || 0), -1, 1);
  }
  return clamp(sigmoid(z), 0.01, 0.99);
}

function update(modelInput, features, pnlUsdt, stakeUsdt, learningRate = 0.035) {
  const model = ensureModel(modelInput);
  const prediction = predict(model, features);
  const normalizedReward = clamp(stakeUsdt > 0 ? pnlUsdt / stakeUsdt : pnlUsdt, -0.03, 0.03) / 0.03;
  const target = pnlUsdt > 0 ? clamp(0.70 + Math.max(0, normalizedReward) * 0.25, 0.70, 0.95)
    : pnlUsdt < 0 ? clamp(0.30 + Math.min(0, normalizedReward) * 0.25, 0.05, 0.30)
      : 0.50;
  const error = target - prediction;
  const l2 = 0.0008;

  model.bias = clamp(model.bias + learningRate * error, -2.5, 2.5);
  for (const name of FEATURE_NAMES) {
    const x = clamp(Number(features[name] || 0), -1, 1);
    const weight = Number(model.weights[name] || 0);
    model.weights[name] = clamp(weight + learningRate * (error * x - l2 * weight), -3, 3);
  }

  model.tradesLearned = Number(model.tradesLearned || 0) + 1;
  if (pnlUsdt > 0) model.winsLearned = Number(model.winsLearned || 0) + 1;
  else if (pnlUsdt < 0) model.lossesLearned = Number(model.lossesLearned || 0) + 1;
  model.rollingReward = Number(model.rollingReward || 0) * 0.9 + normalizedReward * 0.1;
  model.lastUpdateAt = Date.now();
  return model;
}

function topWeights(modelInput, limit = 4) {
  const model = ensureModel(modelInput);
  return Object.entries(model.weights)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([name, weight]) => ({ name, weight }));
}

module.exports = {
  FEATURE_NAMES,
  defaultModel,
  ensureModel,
  predict,
  update,
  topWeights,
};
