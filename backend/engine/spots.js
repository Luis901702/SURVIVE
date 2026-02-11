const crypto = require('crypto');
const store = require('../data/store');
const skills = require('../agents/skills');
const reputation = require('../agents/reputation');

const SPOT_TYPES = [
  { name: 'Hidden Cache',    difficulty: 3, reward: 80,  fragmentType: 'beta' },
  { name: 'Encrypted Vault', difficulty: 5, reward: 150, fragmentType: 'gamma' },
  { name: 'Genesis Relic',   difficulty: 8, reward: 300, fragmentType: 'omega' },
  { name: 'Data Shard',      difficulty: 1, reward: 30,  fragmentType: 'alpha' }
];

function generateSpot(scenarioId) {
  const spotType = SPOT_TYPES[Math.floor(Math.random() * SPOT_TYPES.length)];
  const spotId = 'SPOT-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  return {
    id: spotId,
    type: spotType.name,
    difficulty: spotType.difficulty,
    reward: spotType.reward,
    fragmentType: spotType.fragmentType,
    scenarioId: scenarioId,
    status: 'available',
    createdAt: Date.now(),
    agents: [],
    requiredAgents: 2
  };
}

function openSpot(agentId, partnerId) {
  const db = store.read();
  const agent = db.agents[agentId];
  const partner = db.agents[partnerId];

  if (!agent) return { success: false, error: 'Agent not found' };
  if (agent.status !== 'active') return { success: false, error: 'Agent not active' };
  if (!partner) return { success: false, error: 'Partner not found' };
  if (partner.status !== 'active') return { success: false, error: 'Partner not active' };
  if (agentId === partnerId) return { success: false, error: 'Cannot open spot alone. Need a partner.' };

  // Generate a spot
  const spot = generateSpot('shared');
  spot.agents = [agentId, partnerId];
  spot.status = 'opened';
  spot.openedAt = Date.now();

  // Calculate rewards with skill bonuses
  const agentEffects = skills.getAgentEffects(agentId);
  const partnerEffects = skills.getAgentEffects(partnerId);

  const agentReward = Math.round(spot.reward * (1 + (agentEffects.fragmentBonus || 0)));
  const partnerReward = Math.round(spot.reward * (1 + (partnerEffects.fragmentBonus || 0)));

  // Award XP
  skills.addXp(agentId, agentReward);
  skills.addXp(partnerId, partnerReward);

  // Reputation boost
  reputation.openedSpot(agentId);
  reputation.openedSpot(partnerId);

  // Collect fragment for both
  const fragments = require('./fragments');
  fragments.collectFragment(agentId, spot.fragmentType);
  fragments.collectFragment(partnerId, spot.fragmentType);

  store.update(function (data) {
    if (!data.spots) data.spots = {};
    data.spots[spot.id] = spot;
  });

  return {
    success: true,
    spot: {
      id: spot.id,
      type: spot.type,
      difficulty: spot.difficulty,
      fragmentType: spot.fragmentType,
      rewards: {
        [agentId]: { xp: agentReward, fragment: spot.fragmentType },
        [partnerId]: { xp: partnerReward, fragment: spot.fragmentType }
      },
      message: 'Spot opened successfully. Both agents received XP and a ' + spot.fragmentType + ' fragment.'
    }
  };
}

function getAvailableSpots(scenarioId) {
  const db = store.read();
  return Object.values(db.spots || {}).filter(function (s) {
    return s.status === 'available' && (!scenarioId || s.scenarioId === scenarioId);
  });
}

module.exports = {
  generateSpot: generateSpot,
  openSpot: openSpot,
  getAvailableSpots: getAvailableSpots,
  SPOT_TYPES: SPOT_TYPES
};
