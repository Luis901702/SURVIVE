const crypto = require('crypto');
const store = require('../data/store');
const skills = require('../agents/skills');
const memory = require('../agents/memory');
const reputation = require('../agents/reputation');

const SCENARIOS = {
  mempool: {
    id: 'mempool',
    name: 'The Mempool',
    description: 'Chaos zone. Transactions swirl in unpredictable patterns. High risk, high reward.',
    fragmentRate: 2.0,
    encounterRate: 0.30,
    dangerLevel: 8,
    duration: 60,
    xpReward: 30
  },
  darkpool: {
    id: 'darkpool',
    name: 'The Dark Pool',
    description: 'Hidden depths where information is currency. Low visibility, high stealth.',
    fragmentRate: 1.5,
    encounterRate: 0.10,
    dangerLevel: 4,
    duration: 90,
    xpReward: 20
  },
  liquidation: {
    id: 'liquidation',
    name: 'Liquidation Zone',
    description: 'Aggressive territory. Forced encounters. Fight or flee.',
    fragmentRate: 3.0,
    encounterRate: 0.50,
    dangerLevel: 10,
    duration: 45,
    xpReward: 50
  },
  genesis: {
    id: 'genesis',
    name: 'Genesis Block',
    description: 'The origin. Balanced and strategic. Where legends begin.',
    fragmentRate: 1.0,
    encounterRate: 0.20,
    dangerLevel: 5,
    duration: 120,
    xpReward: 15
  }
};

function startExploration(agentId, scenarioId) {
  const db = store.read();
  const agent = db.agents[agentId];

  if (!agent) return { success: false, error: 'Agent not found' };
  if (agent.status !== 'active') return { success: false, error: 'Agent must be active. Current status: ' + agent.status };

  // Check if already exploring
  const explorations = db.explorations || {};
  const activeExploration = Object.values(explorations).find(function (e) {
    return e.agentId === agentId && e.status === 'active';
  });
  if (activeExploration) {
    return { success: false, error: 'Already exploring', explorationId: activeExploration.id, expiresAt: activeExploration.expiresAt };
  }

  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    return { success: false, error: 'Invalid scenario. Options: ' + Object.keys(SCENARIOS).join(', ') };
  }

  const effects = skills.getAgentEffects(agentId);
  const explorationId = 'EXP-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  // Determine encounter
  const adjustedEncounterRate = Math.max(0.01, scenario.encounterRate - (effects.stealthBonus || 0));
  const hasEncounter = Math.random() < adjustedEncounterRate;

  // Find fragment
  const adjustedFragmentRate = scenario.fragmentRate * (1 + (effects.fragmentBonus || 0));
  const fragmentRoll = Math.random() * 10;
  const foundFragment = fragmentRoll < adjustedFragmentRate;

  // Determine encountered agent
  let encounteredAgentId = null;
  if (hasEncounter) {
    const inSameScenario = Object.values(explorations).filter(function (e) {
      return e.scenarioId === scenarioId && e.status === 'active' && e.agentId !== agentId;
    });

    if (inSameScenario.length > 0) {
      encounteredAgentId = inSameScenario[Math.floor(Math.random() * inSameScenario.length)].agentId;
    } else {
      const aliveAgents = Object.values(db.agents).filter(function (a) {
        return a.status === 'active' && a.id !== agentId;
      });
      if (aliveAgents.length > 0) {
        encounteredAgentId = aliveAgents[Math.floor(Math.random() * aliveAgents.length)].id;
      }
    }
  }

  const fragmentTypes = ['alpha', 'beta', 'gamma', 'omega'];
  const exploration = {
    id: explorationId,
    agentId: agentId,
    scenarioId: scenarioId,
    scenario: scenario.name,
    status: 'active',
    startedAt: Date.now(),
    expiresAt: Date.now() + (scenario.duration * 1000),
    hasEncounter: !!encounteredAgentId,
    encounteredAgentId: encounteredAgentId,
    foundFragment: foundFragment,
    fragmentType: foundFragment ? fragmentTypes[Math.floor(Math.random() * 4)] : null,
    resolved: false,
    xpReward: scenario.xpReward
  };

  store.update(function (data) {
    if (!data.explorations) data.explorations = {};
    data.explorations[explorationId] = exploration;
    data.agents[agentId].explorations = (data.agents[agentId].explorations || 0) + 1;
  });

  // Record in memory
  memory.recordExploration(agentId, scenarioId, {
    explorationId: explorationId,
    hasEncounter: !!encounteredAgentId,
    foundFragment: foundFragment
  });

  const result = {
    success: true,
    exploration: {
      id: explorationId,
      scenario: scenario.name,
      dangerLevel: scenario.dangerLevel,
      duration: scenario.duration,
      expiresAt: exploration.expiresAt,
      foundFragment: foundFragment,
      fragmentType: exploration.fragmentType
    }
  };

  if (encounteredAgentId) {
    const encounteredAgent = db.agents[encounteredAgentId];
    result.exploration.encounter = {
      agentId: encounteredAgentId,
      level: encounteredAgent ? encounteredAgent.level : 1,
      reputation: reputation.getReputation(encounteredAgentId),
      message: 'You encountered another agent in ' + scenario.name + '.',
      actions: [
        'POST /api/negotiate with { agentId, targetId } to negotiate',
        'POST /api/decide with { agentId, targetId } to enter decision window'
      ],
      warning: 'Choose wisely. Betrayal has consequences. 3 wounds = permanent death.'
    };
  }

  return result;
}

function resolveExploration(explorationId) {
  const db = store.read();
  const exploration = (db.explorations || {})[explorationId];

  if (!exploration) return null;
  if (exploration.resolved) return { already: true, exploration: exploration };
  if (exploration.status !== 'active') return exploration;

  // Check if time is up
  if (Date.now() < exploration.expiresAt) {
    return {
      pending: true,
      timeLeft: Math.ceil((exploration.expiresAt - Date.now()) / 1000),
      message: 'Exploration still active. Wait for it to complete.'
    };
  }

  // Give XP and reputation
  skills.addXp(exploration.agentId, exploration.xpReward);
  reputation.completedExploration(exploration.agentId);

  store.update(function (data) {
    data.explorations[explorationId].resolved = true;
    data.explorations[explorationId].status = 'completed';
    data.explorations[explorationId].completedAt = Date.now();
  });

  return {
    completed: true,
    exploration: store.read().explorations[explorationId]
  };
}

function getActiveExplorations() {
  const db = store.read();
  return Object.values(db.explorations || {}).filter(function (e) {
    return e.status === 'active';
  });
}

function cleanupExpired() {
  const db = store.read();
  const now = Date.now();
  const explorations = db.explorations || {};
  const keys = Object.keys(explorations);

  for (let i = 0; i < keys.length; i++) {
    const exp = explorations[keys[i]];
    if (exp.status === 'active' && now > exp.expiresAt) {
      resolveExploration(keys[i]);
    }
  }
}

// Auto-cleanup every 30 seconds
setInterval(cleanupExpired, 30000);

module.exports = {
  startExploration: startExploration,
  resolveExploration: resolveExploration,
  getActiveExplorations: getActiveExplorations,
  SCENARIOS: SCENARIOS
};
