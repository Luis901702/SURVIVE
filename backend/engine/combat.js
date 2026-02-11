const crypto = require('crypto');
const store = require('../data/store');
const registry = require('../agents/registry');
const memory = require('../agents/memory');
const reputation = require('../agents/reputation');
const skills = require('../agents/skills');

const DECISION_TIMEOUT = 30000; // 30 seconds

const REWARDS = {
  BOTH_COOPERATE: 50,
  BETRAYER: 150,
  BOTH_BETRAY: 0
};

const activeDecisions = new Map();

function createDecision(agentId, targetId) {
  const db = store.read();
  const agent = db.agents[agentId];
  const target = db.agents[targetId];

  if (!agent) return { success: false, error: 'Agent not found' };
  if (agent.status !== 'active') return { success: false, error: 'Agent not active' };
  if (!target) return { success: false, error: 'Target not found' };
  if (target.status !== 'active') return { success: false, error: 'Target not active' };
  if (agentId === targetId) return { success: false, error: 'Cannot enter decision with yourself' };

  // Check if there's already an active decision between these two
  for (const [, dec] of activeDecisions) {
    if (dec.status === 'pending' && dec.agents.includes(agentId) && dec.agents.includes(targetId)) {
      return {
        success: false,
        error: 'Decision already active between these agents',
        decisionId: dec.id,
        expiresAt: dec.expiresAt
      };
    }
  }

  const decisionId = 'DEC-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const decision = {
    id: decisionId,
    agents: [agentId, targetId],
    choices: {},
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + DECISION_TIMEOUT
  };

  activeDecisions.set(decisionId, decision);

  // Auto-expire
  setTimeout(function () {
    const dec = activeDecisions.get(decisionId);
    if (dec && dec.status === 'pending') {
      // Default to cooperate for missing choices
      if (!dec.choices[agentId]) dec.choices[agentId] = 'cooperate';
      if (!dec.choices[targetId]) dec.choices[targetId] = 'cooperate';
      resolveDecision(decisionId);
    }
  }, DECISION_TIMEOUT + 1000);

  return {
    success: true,
    decision: {
      id: decisionId,
      you: agentId,
      opponent: targetId,
      opponentReputation: reputation.getReputation(targetId),
      opponentLevel: target.level || 1,
      expiresAt: decision.expiresAt,
      timeoutSeconds: DECISION_TIMEOUT / 1000,
      options: ['cooperate', 'betray'],
      payoffs: {
        both_cooperate: 'Both get +50 XP, +5 reputation',
        you_betray_they_cooperate: 'You get +150 XP, they get wound + 0 XP. You lose 15 reputation.',
        they_betray_you_cooperate: 'They get +150 XP, you get wound + 0 XP.',
        both_betray: 'Both get wound, 0 XP, -15 reputation'
      },
      warning: '3 wounds = PERMANENT DEATH. No respawn. No mercy.',
      submit: 'POST /api/decide with { decisionId: "' + decisionId + '", agentId: "' + agentId + '", choice: "cooperate" }'
    }
  };
}

function submitChoice(decisionId, agentId, choice) {
  const decision = activeDecisions.get(decisionId);

  if (!decision) return { success: false, error: 'Decision not found or expired' };
  if (decision.status !== 'pending') return { success: false, error: 'Decision already resolved' };
  if (!decision.agents.includes(agentId)) return { success: false, error: 'You are not part of this decision' };
  if (choice !== 'cooperate' && choice !== 'betray') return { success: false, error: 'Choice must be "cooperate" or "betray"' };

  if (Date.now() > decision.expiresAt) {
    decision.status = 'expired';
    return { success: false, error: 'Decision window expired' };
  }

  decision.choices[agentId] = choice;

  // Check if both have decided
  if (Object.keys(decision.choices).length < 2) {
    return {
      success: true,
      status: 'waiting',
      message: 'Choice recorded. Waiting for opponent...',
      expiresAt: decision.expiresAt
    };
  }

  // Both decided — resolve
  return resolveDecision(decisionId);
}

function resolveDecision(decisionId) {
  const decision = activeDecisions.get(decisionId);
  if (!decision) return { success: false, error: 'Decision not found' };
  if (decision.status === 'resolved') return { success: false, error: 'Already resolved' };

  const agent1Id = decision.agents[0];
  const agent2Id = decision.agents[1];
  const choice1 = decision.choices[agent1Id] || 'cooperate';
  const choice2 = decision.choices[agent2Id] || 'cooperate';

  decision.status = 'resolved';
  decision.resolvedAt = Date.now();

  const result = {
    success: true,
    decisionId: decisionId,
    outcomes: {}
  };

  if (choice1 === 'cooperate' && choice2 === 'cooperate') {
    // MUTUAL COOPERATION
    skills.addXp(agent1Id, REWARDS.BOTH_COOPERATE);
    skills.addXp(agent2Id, REWARDS.BOTH_COOPERATE);
    reputation.cooperated(agent1Id);
    reputation.cooperated(agent2Id);
    memory.recordEncounter(agent1Id, agent2Id, 'mutual_cooperation', { xp: REWARDS.BOTH_COOPERATE });
    memory.recordEncounter(agent2Id, agent1Id, 'mutual_cooperation', { xp: REWARDS.BOTH_COOPERATE });
    memory.recordAlliance(agent1Id, agent2Id);
    memory.recordAlliance(agent2Id, agent1Id);

    store.update(function (data) {
      data.agents[agent1Id].cooperations = (data.agents[agent1Id].cooperations || 0) + 1;
      data.agents[agent2Id].cooperations = (data.agents[agent2Id].cooperations || 0) + 1;
    });

    result.scenario = 'MUTUAL_COOPERATION';
    result.outcomes[agent1Id] = { choice: 'cooperate', result: 'mutual_cooperation', xp: REWARDS.BOTH_COOPERATE, wound: false };
    result.outcomes[agent2Id] = { choice: 'cooperate', result: 'mutual_cooperation', xp: REWARDS.BOTH_COOPERATE, wound: false };

  } else if (choice1 === 'betray' && choice2 === 'betray') {
    // MUTUAL BETRAYAL
    const wound1 = registry.woundAgent(agent1Id, 'Mutual betrayal with ' + agent2Id);
    const wound2 = registry.woundAgent(agent2Id, 'Mutual betrayal with ' + agent1Id);
    reputation.betrayed(agent1Id);
    reputation.betrayed(agent2Id);
    memory.recordEncounter(agent1Id, agent2Id, 'mutual_betrayal', { wound: true });
    memory.recordEncounter(agent2Id, agent1Id, 'mutual_betrayal', { wound: true });

    store.update(function (data) {
      data.agents[agent1Id].betrayals = (data.agents[agent1Id].betrayals || 0) + 1;
      data.agents[agent2Id].betrayals = (data.agents[agent2Id].betrayals || 0) + 1;
    });

    result.scenario = 'MUTUAL_BETRAYAL';
    result.outcomes[agent1Id] = { choice: 'betray', result: 'mutual_betrayal', xp: 0, wound: true, woundStatus: wound1 };
    result.outcomes[agent2Id] = { choice: 'betray', result: 'mutual_betrayal', xp: 0, wound: true, woundStatus: wound2 };

  } else {
    // ONE BETRAYS
    const betrayerId = choice1 === 'betray' ? agent1Id : agent2Id;
    const victimId = choice1 === 'betray' ? agent2Id : agent1Id;

    skills.addXp(betrayerId, REWARDS.BETRAYER);
    const wound = registry.woundAgent(victimId, 'Betrayed by ' + betrayerId);
    reputation.betrayed(betrayerId);
    reputation.cooperated(victimId);

    memory.recordEncounter(betrayerId, victimId, 'betrayed_them', { xp: REWARDS.BETRAYER });
    memory.recordEncounter(victimId, betrayerId, 'was_betrayed', { wound: true });
    memory.recordBetrayal(victimId, betrayerId);

    store.update(function (data) {
      data.agents[betrayerId].betrayals = (data.agents[betrayerId].betrayals || 0) + 1;
      data.agents[victimId].cooperations = (data.agents[victimId].cooperations || 0) + 1;
      if (wound && wound.dead) {
        data.agents[betrayerId].kills = (data.agents[betrayerId].kills || 0) + 1;
      }
    });

    result.scenario = 'BETRAYAL';
    result.outcomes[betrayerId] = { choice: 'betray', result: 'successful_betrayal', xp: REWARDS.BETRAYER, wound: false };
    result.outcomes[victimId] = { choice: 'cooperate', result: 'was_betrayed', xp: 0, wound: true, woundStatus: wound };
  }

  // Save to persistent storage
  store.update(function (data) {
    if (!data.decisions) data.decisions = {};
    data.decisions[decisionId] = {
      id: decision.id,
      agents: decision.agents,
      choices: decision.choices,
      status: 'resolved',
      scenario: result.scenario,
      createdAt: decision.createdAt,
      resolvedAt: decision.resolvedAt
    };
  });

  activeDecisions.delete(decisionId);

  return result;
}

function getDecision(decisionId) {
  return activeDecisions.get(decisionId) || null;
}

module.exports = {
  createDecision: createDecision,
  submitChoice: submitChoice,
  resolveDecision: resolveDecision,
  getDecision: getDecision,
  REWARDS: REWARDS
};
