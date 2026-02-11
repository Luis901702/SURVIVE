const store = require('../data/store');

const BASE_REPUTATION = 50;
const MAX_REPUTATION = 100;
const MIN_REPUTATION = 0;

const REPUTATION_TIERS = {
  PARIAH:    { min: 0,  max: 15,  label: 'Pariah',    modifier: -0.5 },
  UNTRUSTED: { min: 16, max: 30,  label: 'Untrusted', modifier: -0.25 },
  NEUTRAL:   { min: 31, max: 50,  label: 'Neutral',   modifier: 0 },
  RESPECTED: { min: 51, max: 70,  label: 'Respected', modifier: 0.15 },
  TRUSTED:   { min: 71, max: 85,  label: 'Trusted',   modifier: 0.3 },
  LEGENDARY: { min: 86, max: 100, label: 'Legendary', modifier: 0.5 }
};

function getTier(score) {
  const tiers = Object.values(REPUTATION_TIERS);
  for (let i = 0; i < tiers.length; i++) {
    if (score >= tiers[i].min && score <= tiers[i].max) return tiers[i];
  }
  return REPUTATION_TIERS.NEUTRAL;
}

function getReputation(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return null;

  const rep = agent.reputation != null ? agent.reputation : BASE_REPUTATION;
  const tier = getTier(rep);

  return {
    score: rep,
    tier: tier.label,
    modifier: tier.modifier
  };
}

function modifyReputation(agentId, change, reason) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return null;

  const oldRep = agent.reputation != null ? agent.reputation : BASE_REPUTATION;
  const newRep = Math.max(MIN_REPUTATION, Math.min(MAX_REPUTATION, oldRep + change));

  store.update(function (data) {
    data.agents[agentId].reputation = newRep;
  });

  return {
    agentId: agentId,
    oldReputation: oldRep,
    newReputation: newRep,
    change: change,
    reason: reason,
    tier: getTier(newRep).label
  };
}

function cooperated(agentId) {
  return modifyReputation(agentId, 5, 'Cooperated with another agent');
}

function betrayed(agentId) {
  return modifyReputation(agentId, -15, 'Betrayed another agent');
}

function completedExploration(agentId) {
  return modifyReputation(agentId, 2, 'Completed exploration');
}

function openedSpot(agentId) {
  return modifyReputation(agentId, 3, 'Opened a spot with ally');
}

module.exports = {
  getReputation: getReputation,
  modifyReputation: modifyReputation,
  cooperated: cooperated,
  betrayed: betrayed,
  completedExploration: completedExploration,
  openedSpot: openedSpot,
  REPUTATION_TIERS: REPUTATION_TIERS
};
