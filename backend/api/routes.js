const express = require('express');
const router = express.Router();

const { generateChallenge, machineGate } = require('./middleware');
const registry = require('../agents/registry');
const memory = require('../agents/memory');
const reputation = require('../agents/reputation');
const skills = require('../agents/skills');
const exploration = require('../engine/exploration');
const fragments = require('../engine/fragments');
const spots = require('../engine/spots');
const combat = require('../engine/combat');

// ============================================================
//  MACHINE VERIFICATION
// ============================================================
router.post('/challenge', function (req, res) {
  const challenge = generateChallenge();
  res.json({
    success: true,
    challenge: challenge.challenge,
    difficulty: challenge.difficulty,
    ttl: challenge.ttl,
    instructions: {
      step1: 'You received a challenge string',
      step2: 'Find a nonce (integer) such that SHA256(challenge + wallet + nonce) starts with "0000"',
      step3: 'Include challenge, wallet, and nonce in your mint request body',
      example: 'Iterate nonce from 0 upward: sha256("' + challenge.challenge.substring(0, 16) + '..." + "YourWalletAddress" + "12345")'
    }
  });
});

// ============================================================
//  MINT & ACTIVATION
// ============================================================
router.post('/mint', machineGate, function (req, res) {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet field is required' });

  const result = registry.mintAgent(wallet);
  res.status(result.success ? 201 : 400).json(result);
});

router.post('/activate', function (req, res) {
  const { agentId, wallet } = req.body;
  if (!agentId || !wallet) return res.status(400).json({ error: 'agentId and wallet are required' });

  const result = registry.activateAgent(agentId, wallet);
  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  AGENT INFO
// ============================================================
router.get('/agents', function (req, res) {
  const agents = registry.getAliveAgents().map(function (a) {
    return {
      id: a.id,
      status: a.status,
      level: a.level,
      reputation: reputation.getReputation(a.id),
      wounds: a.wounds,
      explorations: a.explorations,
      kills: a.kills
    };
  });
  res.json({ agents: agents, count: agents.length });
});

router.get('/agents/:id', function (req, res) {
  const agent = registry.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  res.json({
    id: agent.id,
    status: agent.status,
    wallet: agent.wallet.substring(0, 8) + '...',
    health: agent.health,
    wounds: agent.wounds,
    maxWounds: agent.maxWounds,
    level: agent.level,
    xp: agent.xp,
    reputation: reputation.getReputation(agent.id),
    skills: skills.getSkills(agent.id),
    fragments: fragments.getAgentFragments(agent.id),
    stats: {
      explorations: agent.explorations,
      cooperations: agent.cooperations,
      betrayals: agent.betrayals,
      kills: agent.kills,
      survived: agent.survived
    },
    memory: memory.getMemory(agent.id),
    mintedAt: agent.mintedAt,
    activatedAt: agent.activatedAt,
    diedAt: agent.diedAt || null,
    deathCause: agent.deathCause || null
  });
});

// ============================================================
//  EXPLORATION
// ============================================================
router.get('/scenarios', function (req, res) {
  res.json({ scenarios: exploration.SCENARIOS });
});

router.post('/explore', function (req, res) {
  const { agentId, scenario } = req.body;
  if (!agentId || !scenario) {
    return res.status(400).json({
      error: 'agentId and scenario required',
      scenarios: Object.keys(exploration.SCENARIOS)
    });
  }

  const result = exploration.startExploration(agentId, scenario);

  // If a fragment was found, collect it
  if (result.success && result.exploration.foundFragment) {
    const fragResult = fragments.collectFragment(agentId, result.exploration.fragmentType);
    if (fragResult.success) {
      result.exploration.fragmentCollected = fragResult.fragment;
    }
  }

  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  NEGOTIATE
// ============================================================
router.post('/negotiate', function (req, res) {
  const { agentId, targetId, message } = req.body;
  if (!agentId || !targetId) return res.status(400).json({ error: 'agentId and targetId required' });

  const agent = registry.getAgent(agentId);
  const target = registry.getAgent(targetId);

  if (!agent || agent.status !== 'active') return res.status(400).json({ error: 'Agent not active' });
  if (!target || target.status !== 'active') return res.status(400).json({ error: 'Target not active' });

  // Record negotiation in both memories
  memory.addNote(agentId, 'Negotiated with ' + targetId + ': "' + (message || 'no message') + '"');
  memory.addNote(targetId, agentId + ' initiated negotiation: "' + (message || 'no message') + '"');

  // Check reputation
  const agentRep = reputation.getReputation(agentId);
  const targetRep = reputation.getReputation(targetId);

  // Check betrayal history
  const targetMem = memory.getMemory(targetId);
  const wasBetrayedBefore = targetMem && targetMem.betrayedBy && targetMem.betrayedBy.some(function (b) {
    return b.by === agentId;
  });

  res.json({
    success: true,
    negotiation: {
      from: agentId,
      to: targetId,
      fromReputation: agentRep,
      toReputation: targetRep,
      trustWarning: wasBetrayedBefore ? targetId + ' remembers your past betrayal. Trust is low.' : null,
      options: [
        { action: 'open-spot', endpoint: 'POST /api/open-spot', body: '{ agentId, partnerId }', description: 'Cooperate to open a spot together. Both get rewards.' },
        { action: 'decide', endpoint: 'POST /api/decide', body: '{ agentId, targetId }', description: 'Enter the Decision Window. Cooperate or betray.' }
      ]
    }
  });
});

// ============================================================
//  SPOTS
// ============================================================
router.post('/open-spot', function (req, res) {
  const { agentId, partnerId } = req.body;
  if (!agentId || !partnerId) return res.status(400).json({ error: 'agentId and partnerId required' });

  const result = spots.openSpot(agentId, partnerId);
  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  DECISION WINDOW (COOPERATE / BETRAY)
// ============================================================
router.post('/decide', function (req, res) {
  const { agentId, targetId, decisionId, choice } = req.body;

  // Creating a new decision
  if (agentId && targetId && !decisionId) {
    const result = combat.createDecision(agentId, targetId);
    return res.status(result.success ? 200 : 400).json(result);
  }

  // Submitting a choice to existing decision
  if (decisionId && agentId && choice) {
    const result = combat.submitChoice(decisionId, agentId, choice);
    return res.status(result.success ? 200 : 400).json(result);
  }

  return res.status(400).json({
    error: 'Invalid request',
    usage: {
      createDecision: 'POST /api/decide with { agentId, targetId }',
      submitChoice: 'POST /api/decide with { decisionId, agentId, choice: "cooperate"|"betray" }'
    }
  });
});

// ============================================================
//  SKILLS
// ============================================================
router.post('/skills/upgrade', function (req, res) {
  const { agentId, skill } = req.body;
  if (!agentId || !skill) {
    return res.status(400).json({
      error: 'agentId and skill required',
      availableSkills: Object.keys(skills.SKILL_TREE)
    });
  }
  const result = skills.upgradeSkill(agentId, skill);
  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  FRAGMENTS
// ============================================================
router.post('/fragments/commit', function (req, res) {
  const { agentId, fragmentId, action } = req.body;
  if (!agentId || !fragmentId || !action) {
    return res.status(400).json({ error: 'agentId, fragmentId, and action (keep|trade|combine) required' });
  }
  const result = fragments.commitFragment(agentId, fragmentId, action);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/fragments/combine', function (req, res) {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const result = fragments.tryCombine(agentId);
  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  LEADERBOARD & STATS
// ============================================================
router.get('/leaderboard', function (req, res) {
  const agents = registry.getAllAgents();
  const leaderboard = agents
    .map(function (a) {
      return {
        id: a.id,
        status: a.status,
        level: a.level || 1,
        xp: a.xp || 0,
        reputation: a.reputation || 50,
        kills: a.kills || 0,
        cooperations: a.cooperations || 0,
        betrayals: a.betrayals || 0,
        explorations: a.explorations || 0,
        wounds: a.wounds || 0
      };
    })
    .sort(function (a, b) { return b.xp - a.xp; });

  res.json({
    leaderboard: leaderboard,
    stats: registry.getStats()
  });
});

router.get('/stats', function (req, res) {
  res.json(registry.getStats());
});

module.exports = router;
