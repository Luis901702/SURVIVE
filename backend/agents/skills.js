const store = require('../data/store');

const SKILL_TREE = {
  scavenger: {
    name: 'Scavenger',
    description: 'Better fragment finding rate',
    maxLevel: 5,
    effect: function (level) { return { fragmentBonus: level * 0.1 }; }
  },
  diplomat: {
    name: 'Diplomat',
    description: 'Better negotiation outcomes',
    maxLevel: 5,
    effect: function (level) { return { negotiationBonus: level * 0.1 }; }
  },
  shadow: {
    name: 'Shadow',
    description: 'Lower encounter rate during exploration',
    maxLevel: 5,
    effect: function (level) { return { stealthBonus: level * 0.05 }; }
  },
  warrior: {
    name: 'Warrior',
    description: 'Survive betrayals better',
    maxLevel: 5,
    effect: function (level) { return { defenseBonus: level * 0.1 }; }
  },
  survivor: {
    name: 'Survivor',
    description: 'Passive health recovery',
    maxLevel: 5,
    effect: function (level) { return { regenBonus: level * 2 }; }
  }
};

const XP_PER_LEVEL = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];

function getAvailablePoints(agent) {
  const level = agent.level || 1;
  const totalPoints = level - 1;
  const agentSkills = agent.skills || {};
  let usedPoints = 0;
  const keys = Object.keys(agentSkills);
  for (let i = 0; i < keys.length; i++) {
    usedPoints += agentSkills[keys[i]];
  }
  return totalPoints - usedPoints;
}

function getSkills(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return null;

  const tree = {};
  const treeKeys = Object.keys(SKILL_TREE);
  for (let i = 0; i < treeKeys.length; i++) {
    const key = treeKeys[i];
    tree[key] = {
      name: SKILL_TREE[key].name,
      description: SKILL_TREE[key].description,
      maxLevel: SKILL_TREE[key].maxLevel,
      currentLevel: (agent.skills || {})[key] || 0
    };
  }

  return {
    xp: agent.xp || 0,
    level: agent.level || 1,
    nextLevelXp: XP_PER_LEVEL[agent.level] || XP_PER_LEVEL[XP_PER_LEVEL.length - 1],
    skills: agent.skills || {},
    availablePoints: getAvailablePoints(agent),
    tree: tree
  };
}

function addXp(agentId, amount) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent || agent.status !== 'active') return null;

  const newXp = (agent.xp || 0) + amount;
  let newLevel = agent.level || 1;

  while (newLevel < XP_PER_LEVEL.length && newXp >= XP_PER_LEVEL[newLevel]) {
    newLevel++;
  }

  const leveledUp = newLevel > (agent.level || 1);

  store.update(function (data) {
    data.agents[agentId].xp = newXp;
    data.agents[agentId].level = newLevel;
  });

  return {
    xp: newXp,
    level: newLevel,
    leveledUp: leveledUp,
    availablePoints: getAvailablePoints(store.read().agents[agentId])
  };
}

function upgradeSkill(agentId, skillName) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent || agent.status !== 'active') return { success: false, error: 'Agent not active' };

  const skill = SKILL_TREE[skillName];
  if (!skill) return { success: false, error: 'Unknown skill: ' + skillName + '. Available: ' + Object.keys(SKILL_TREE).join(', ') };

  const currentLevel = (agent.skills || {})[skillName] || 0;
  if (currentLevel >= skill.maxLevel) return { success: false, error: 'Skill already at max level' };

  const available = getAvailablePoints(agent);
  if (available <= 0) return { success: false, error: 'No skill points available. Level up to earn more.' };

  store.update(function (data) {
    if (!data.agents[agentId].skills) data.agents[agentId].skills = {};
    data.agents[agentId].skills[skillName] = currentLevel + 1;
  });

  return {
    success: true,
    skill: skillName,
    level: currentLevel + 1,
    effect: skill.effect(currentLevel + 1)
  };
}

function getAgentEffects(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return {};

  const effects = {
    fragmentBonus: 0,
    negotiationBonus: 0,
    stealthBonus: 0,
    defenseBonus: 0,
    regenBonus: 0
  };

  const agentSkills = agent.skills || {};
  const keys = Object.keys(agentSkills);
  for (let i = 0; i < keys.length; i++) {
    const skillName = keys[i];
    const level = agentSkills[skillName];
    const skill = SKILL_TREE[skillName];
    if (skill && level > 0) {
      const effect = skill.effect(level);
      const effectKeys = Object.keys(effect);
      for (let j = 0; j < effectKeys.length; j++) {
        effects[effectKeys[j]] = (effects[effectKeys[j]] || 0) + effect[effectKeys[j]];
      }
    }
  }

  return effects;
}

module.exports = {
  getSkills: getSkills,
  addXp: addXp,
  upgradeSkill: upgradeSkill,
  getAgentEffects: getAgentEffects,
  SKILL_TREE: SKILL_TREE,
  XP_PER_LEVEL: XP_PER_LEVEL
};
