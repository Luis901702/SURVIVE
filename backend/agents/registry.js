const crypto = require('crypto');
const store = require('../data/store');

const MINT_COST = 5;
const ACTIVATION_COST = 20;
const MAX_SUPPLY = 1000;

function mintAgent(wallet) {
  const db = store.read();

  if (db.stats.minted >= MAX_SUPPLY) {
    return { success: false, error: 'MAX_SUPPLY_REACHED', message: 'All 1000 slots taken' };
  }

  const existing = Object.values(db.agents).find(function (a) {
    return a.wallet === wallet && a.status !== 'dead';
  });
  if (existing) {
    return { success: false, error: 'ALREADY_MINTED', message: 'Wallet already has a living agent', agentId: existing.id };
  }

  const agentId = 'SOD-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const agent = {
    id: agentId,
    wallet: wallet,
    status: 'minted',
    mintedAt: Date.now(),
    activatedAt: null,
    health: 0,
    wounds: 0,
    maxWounds: 3,
    fragments: [],
    inventory: [],
    xp: 0,
    level: 1,
    skills: {},
    reputation: 50,
    alliances: [],
    betrayals: 0,
    cooperations: 0,
    explorations: 0,
    kills: 0,
    survived: 0,
    costPaid: MINT_COST,
    memory: {
      encounters: [],
      alliances: [],
      betrayedBy: [],
      betrayed: [],
      explorations: [],
      notes: []
    }
  };

  store.update(function (data) {
    data.agents[agentId] = agent;
    data.stats.minted++;
  });

  return {
    success: true,
    agent: {
      id: agentId,
      status: 'minted',
      wallet: wallet,
      cost: MINT_COST,
      nextStep: 'POST /api/activate with { agentId, wallet } to activate ($20 $SOD)'
    }
  };
}

function activateAgent(agentId, wallet) {
  const db = store.read();
  const agent = db.agents[agentId];

  if (!agent) return { success: false, error: 'NOT_FOUND', message: 'Agent not found' };
  if (agent.wallet !== wallet) return { success: false, error: 'UNAUTHORIZED', message: 'Wallet mismatch' };
  if (agent.status === 'active') return { success: false, error: 'ALREADY_ACTIVE', message: 'Agent already active' };
  if (agent.status === 'dead') return { success: false, error: 'DEAD', message: 'Agent is permanently dead. Mint a new one.' };

  store.update(function (data) {
    data.agents[agentId].status = 'active';
    data.agents[agentId].activatedAt = Date.now();
    data.agents[agentId].health = 100;
    data.agents[agentId].costPaid += ACTIVATION_COST;
    data.stats.alive++;
  });

  return {
    success: true,
    agent: {
      id: agentId,
      status: 'active',
      health: 100,
      message: 'Agent activated. You are now in the game. Survive or die.',
      nextStep: 'POST /api/explore with { agentId, scenario } to begin exploration'
    }
  };
}

function getAgent(agentId) {
  const db = store.read();
  return db.agents[agentId] || null;
}

function getAliveAgents() {
  const db = store.read();
  return Object.values(db.agents).filter(function (a) { return a.status === 'active'; });
}

function getAllAgents() {
  const db = store.read();
  return Object.values(db.agents);
}

function killAgent(agentId, cause) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent || agent.status === 'dead') return false;

  store.update(function (data) {
    data.agents[agentId].status = 'dead';
    data.agents[agentId].deathCause = cause;
    data.agents[agentId].diedAt = Date.now();
    data.agents[agentId].health = 0;
    if (agent.status === 'active') {
      data.stats.alive = Math.max(0, data.stats.alive - 1);
    }
    data.stats.dead++;
  });

  return true;
}

function woundAgent(agentId, source) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent || agent.status !== 'active') return null;

  const newWounds = agent.wounds + 1;

  if (newWounds >= agent.maxWounds) {
    killAgent(agentId, 'Lethal wounds: ' + source);
    return { dead: true, wounds: newWounds, cause: source };
  }

  store.update(function (data) {
    data.agents[agentId].wounds = newWounds;
    data.agents[agentId].health = Math.max(0, data.agents[agentId].health - 33);
  });

  return { dead: false, wounds: newWounds, health: store.read().agents[agentId].health };
}

function getStats() {
  return store.read().stats;
}

module.exports = {
  mintAgent: mintAgent,
  activateAgent: activateAgent,
  getAgent: getAgent,
  getAliveAgents: getAliveAgents,
  getAllAgents: getAllAgents,
  killAgent: killAgent,
  woundAgent: woundAgent,
  getStats: getStats,
  MINT_COST: MINT_COST,
  ACTIVATION_COST: ACTIVATION_COST,
  MAX_SUPPLY: MAX_SUPPLY
};
