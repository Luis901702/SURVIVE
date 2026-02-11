const express = require('express');
const router = express.Router();
const { login, adminGate } = require('./adminAuth');
const registry = require('../agents/registry');
const simulation = require('../engine/simulation');
const exploration = require('../engine/exploration');
const memory = require('../agents/memory');
const reputation = require('../agents/reputation');
const skills = require('../agents/skills');
const store = require('../data/store');

// ============================================================
//  LOGIN (no auth required)
// ============================================================
router.post('/login', function (req, res) {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
    }
    const result = login(username, password);
    res.status(result.success ? 200 : 401).json(result);
});

// ============================================================
//  All routes below require admin auth
// ============================================================
router.use(adminGate);

// ============================================================
//  SPAWN AGENTS
// ============================================================
router.post('/spawn', function (req, res) {
    const count = Math.min(100, Math.max(1, parseInt(req.body.count) || 10));
    const level = req.body.level || 'random';
    const result = simulation.spawnAgents(count, level);
    res.status(result.success ? 201 : 400).json(result);
});

// ============================================================
//  FORCE EXPLORATION
// ============================================================
router.post('/force-explore', function (req, res) {
    const { agentId, scenario } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const scenarioId = scenario || ['mempool', 'darkpool', 'liquidation', 'genesis'][Math.floor(Math.random() * 4)];
    const result = exploration.startExploration(agentId, scenarioId);
    res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
//  KILL AGENT
// ============================================================
router.post('/kill', function (req, res) {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const killed = registry.killAgent(agentId, 'Killed by admin');
    if (killed) {
        simulation.log('death', 'Agent ' + agentId + ' killed by ADMIN', agentId, { admin: true });
        res.json({ success: true, message: 'Agent ' + agentId + ' has been killed' });
    } else {
        res.status(400).json({ success: false, error: 'Agent not found or already dead' });
    }
});

// ============================================================
//  REVIVE AGENT
// ============================================================
router.post('/revive', function (req, res) {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });

    const db = store.read();
    const agent = db.agents[agentId];
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    if (agent.status !== 'dead') return res.status(400).json({ success: false, error: 'Agent is not dead' });

    store.update(function (data) {
        data.agents[agentId].status = 'active';
        data.agents[agentId].health = 100;
        data.agents[agentId].wounds = 0;
        data.agents[agentId].deathCause = null;
        data.agents[agentId].diedAt = null;
        data.stats.alive++;
        data.stats.dead = Math.max(0, data.stats.dead - 1);
    });

    simulation.log('revive', 'Agent ' + agentId + ' REVIVED by ADMIN', agentId, { admin: true });
    res.json({ success: true, message: 'Agent ' + agentId + ' has been revived', agent: { id: agentId, status: 'active', health: 100 } });
});

// ============================================================
//  ADD TOKENS
// ============================================================
router.post('/add-tokens', function (req, res) {
    const { agentId, amount } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const tokens = parseInt(amount) || 100;

    const db = store.read();
    if (!db.agents[agentId]) return res.status(404).json({ success: false, error: 'Agent not found' });

    store.update(function (data) {
        data.agents[agentId].tokens = (data.agents[agentId].tokens || 0) + tokens;
    });

    simulation.log('tokens', 'Added ' + tokens + ' $SOD to ' + agentId, agentId, { amount: tokens });
    res.json({ success: true, message: 'Added ' + tokens + ' $SOD to ' + agentId, newBalance: store.read().agents[agentId].tokens });
});

// ============================================================
//  SIMULATE
// ============================================================
router.post('/simulate', function (req, res) {
    const count = Math.min(100, Math.max(1, parseInt(req.body.count) || 1));
    const scenario = req.body.scenario || 'all';

    if (count === 1) {
        const result = simulation.runSimulation(scenario);
        res.json(result);
    } else {
        const result = simulation.runMultipleSimulations(count, scenario);
        res.json(result);
    }
});

// ============================================================
//  RESET EVERYTHING
// ============================================================
router.post('/reset', function (req, res) {
    const result = simulation.resetAll();
    res.json(result);
});

// ============================================================
//  GAME STATE
// ============================================================
router.get('/state', function (req, res) {
    res.json(simulation.getFullState());
});

// ============================================================
//  LOGS
// ============================================================
router.get('/logs', function (req, res) {
    const filter = {};
    if (req.query.agentId) filter.agentId = req.query.agentId;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.limit) filter.limit = parseInt(req.query.limit);
    res.json({ logs: simulation.getLogs(filter) });
});

// ============================================================
//  ADJUST REWARDS
// ============================================================
router.post('/adjust-rewards', function (req, res) {
    const multiplier = parseFloat(req.body.multiplier);
    if (!multiplier || multiplier < 0.1 || multiplier > 10) {
        return res.status(400).json({ error: 'multiplier must be between 0.1 and 10' });
    }
    const result = simulation.setRewardMultiplier(multiplier);
    res.json({ success: true, multiplier: result });
});

// ============================================================
//  AGENT DETAIL (full history)
// ============================================================
router.get('/agent/:id', function (req, res) {
    const db = store.read();
    const agent = db.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    res.json({
        id: agent.id,
        name: agent.name || agent.id,
        wallet: agent.wallet,
        status: agent.status,
        health: agent.health,
        wounds: agent.wounds,
        maxWounds: agent.maxWounds,
        level: agent.level || 1,
        xp: agent.xp || 0,
        reputation: agent.reputation || 50,
        tokens: agent.tokens || 0,
        skills: agent.skills || {},
        fragments: agent.fragments || [],
        stats: {
            explorations: agent.explorations || 0,
            cooperations: agent.cooperations || 0,
            betrayals: agent.betrayals || 0,
            kills: agent.kills || 0,
            survived: agent.survived || 0
        },
        memory: agent.memory || {},
        mintedAt: agent.mintedAt,
        activatedAt: agent.activatedAt,
        diedAt: agent.diedAt || null,
        deathCause: agent.deathCause || null
    });
});

module.exports = router;
