const crypto = require('crypto');
const store = require('../data/store');
const skills = require('../agents/skills');

const FRAGMENT_TYPES = {
  alpha: { name: 'Alpha Fragment', rarity: 'common', value: 10 },
  beta:  { name: 'Beta Fragment',  rarity: 'uncommon', value: 25 },
  gamma: { name: 'Gamma Fragment', rarity: 'rare', value: 50 },
  omega: { name: 'Omega Fragment', rarity: 'legendary', value: 100 }
};

const COMBINATION_REQUIRED = 3;
const FRAGMENT_TTL = 600000; // 10 minutes

function collectFragment(agentId, fragmentType) {
  const type = FRAGMENT_TYPES[fragmentType];
  if (!type) return { success: false, error: 'Invalid fragment type' };

  const db = store.read();
  if (!db.agents[agentId]) return { success: false, error: 'Agent not found' };
  if (db.agents[agentId].status !== 'active') return { success: false, error: 'Agent not active' };

  const fragmentId = 'FRAG-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  const fragment = {
    id: fragmentId,
    type: fragmentType,
    name: type.name,
    rarity: type.rarity,
    value: type.value,
    ownerId: agentId,
    createdAt: Date.now(),
    expiresAt: Date.now() + FRAGMENT_TTL,
    committed: false,
    commitHash: null,
    committedAction: null
  };

  store.update(function (data) {
    data.agents[agentId].fragments.push(fragment);
  });

  return {
    success: true,
    fragment: {
      id: fragmentId,
      type: fragmentType,
      name: type.name,
      rarity: type.rarity,
      expiresAt: fragment.expiresAt,
      expiresIn: FRAGMENT_TTL,
      hint: 'Collect ' + COMBINATION_REQUIRED + ' ' + type.name + 's to combine for ' + (type.value * COMBINATION_REQUIRED) + ' XP bonus.'
    }
  };
}

function commitFragment(agentId, fragmentId, action) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return { success: false, error: 'Agent not found' };

  const fragIndex = agent.fragments.findIndex(function (f) { return f.id === fragmentId; });
  if (fragIndex === -1) return { success: false, error: 'Fragment not found in inventory' };

  const fragment = agent.fragments[fragIndex];
  if (Date.now() > fragment.expiresAt) {
    store.update(function (data) {
      data.agents[agentId].fragments.splice(fragIndex, 1);
    });
    return { success: false, error: 'Fragment expired and was removed' };
  }

  if (!['keep', 'trade', 'combine'].includes(action)) {
    return { success: false, error: 'Action must be: keep, trade, or combine' };
  }

  const commitHash = crypto.createHash('sha256')
    .update(agentId + fragmentId + action + Date.now())
    .digest('hex');

  store.update(function (data) {
    data.agents[agentId].fragments[fragIndex].committed = true;
    data.agents[agentId].fragments[fragIndex].commitHash = commitHash;
    data.agents[agentId].fragments[fragIndex].committedAction = action;
  });

  return {
    success: true,
    commitHash: commitHash,
    message: 'Fragment ' + fragmentId + ' committed with action: ' + action
  };
}

function tryCombine(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return { success: false, error: 'Agent not found' };
  if (agent.status !== 'active') return { success: false, error: 'Agent not active' };

  // Clean expired fragments
  const now = Date.now();
  const validFragments = agent.fragments.filter(function (f) { return now <= f.expiresAt; });

  // Count by type
  const counts = {};
  for (let i = 0; i < validFragments.length; i++) {
    const t = validFragments[i].type;
    counts[t] = (counts[t] || 0) + 1;
  }

  // Find combinable types
  const combinations = [];
  const typeKeys = Object.keys(counts);
  for (let i = 0; i < typeKeys.length; i++) {
    if (counts[typeKeys[i]] >= COMBINATION_REQUIRED) {
      combinations.push(typeKeys[i]);
    }
  }

  if (combinations.length === 0) {
    return {
      success: false,
      error: 'No combinations available',
      inventory: counts,
      needed: COMBINATION_REQUIRED,
      hint: 'Collect ' + COMBINATION_REQUIRED + ' fragments of the same type to combine.'
    };
  }

  // Perform combinations
  let totalReward = 0;
  for (let c = 0; c < combinations.length; c++) {
    const type = combinations[c];
    const reward = FRAGMENT_TYPES[type].value * COMBINATION_REQUIRED;
    totalReward += reward;

    // Remove used fragments
    let removed = 0;
    store.update(function (data) {
      data.agents[agentId].fragments = data.agents[agentId].fragments.filter(function (f) {
        if (f.type === type && removed < COMBINATION_REQUIRED) {
          removed++;
          return false;
        }
        return true;
      });
    });
  }

  skills.addXp(agentId, totalReward);

  store.update(function (data) {
    data.agents[agentId].survived = (data.agents[agentId].survived || 0) + 1;
  });

  return {
    success: true,
    combined: combinations,
    reward: totalReward,
    message: 'Combined ' + combinations.join(', ') + ' fragments for ' + totalReward + ' XP!'
  };
}

function getAgentFragments(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return null;

  const now = Date.now();
  return agent.fragments
    .filter(function (f) { return now <= f.expiresAt; })
    .map(function (f) {
      return {
        id: f.id,
        type: f.type,
        name: f.name,
        rarity: f.rarity,
        expiresIn: Math.max(0, Math.ceil((f.expiresAt - now) / 1000)),
        committed: f.committed
      };
    });
}

module.exports = {
  collectFragment: collectFragment,
  commitFragment: commitFragment,
  tryCombine: tryCombine,
  getAgentFragments: getAgentFragments,
  FRAGMENT_TYPES: FRAGMENT_TYPES
};
