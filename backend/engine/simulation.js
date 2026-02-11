const store = require('../data/store');
const registry = require('../agents/registry');
const exploration = require('./exploration');
const combat = require('./combat');
const memory = require('../agents/memory');
const reputation = require('../agents/reputation');
const skills = require('../agents/skills');
const fragments = require('./fragments');

// Reward multiplier (adjustable from admin)
let rewardMultiplier = 1;

// Global logs array
const globalLogs = [];
const MAX_LOGS = 2000;

function log(type, message, agentId, details) {
    const entry = {
        timestamp: Date.now(),
        type: type,
        message: message,
        agentId: agentId || null,
        details: details || null
    };
    globalLogs.push(entry);
    if (globalLogs.length > MAX_LOGS) globalLogs.shift();
    return entry;
}

function getLogs(filter) {
    let logs = globalLogs.slice();
    if (filter) {
        if (filter.agentId) {
            logs = logs.filter(function (l) { return l.agentId === filter.agentId; });
        }
        if (filter.type) {
            logs = logs.filter(function (l) { return l.type === filter.type; });
        }
        if (filter.limit) {
            logs = logs.slice(-filter.limit);
        }
    }
    return logs;
}

function clearLogs() {
    globalLogs.length = 0;
}

function getRewardMultiplier() {
    return rewardMultiplier;
}

function setRewardMultiplier(value) {
    rewardMultiplier = value;
    log('system', 'Reward multiplier changed to ' + value + 'x', null, { multiplier: value });
    return rewardMultiplier;
}

// Random agent name generator
const PREFIXES = ['ALPHA', 'BRAVO', 'CYBER', 'DARK', 'ECHO', 'FLUX', 'GHOST', 'HYPER', 'ION', 'JAX',
    'KILO', 'LUNA', 'MEGA', 'NOVA', 'ONYX', 'PIXEL', 'QUARK', 'RAZOR', 'SIGMA', 'TITAN',
    'ULTRA', 'VENOM', 'WARP', 'XENON', 'YETI', 'ZERO', 'APEX', 'BLAZE', 'CRUX', 'DUSK',
    'EMBER', 'FANG', 'GLITCH', 'HELIX', 'IRON', 'JADE', 'KARMA', 'LYNX', 'MATRIX', 'NEON'];

function spawnAgents(count, levelOption) {
    const crypto = require('crypto');
    const results = [];
    const db = store.read();
    const currentMinted = db.stats.minted;

    if (currentMinted + count > registry.MAX_SUPPLY) {
        return {
            success: false,
            error: 'Would exceed MAX_SUPPLY (' + registry.MAX_SUPPLY + '). Current: ' + currentMinted + ', Requested: ' + count
        };
    }

    for (let i = 0; i < count; i++) {
        const agentId = 'SOD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const wallet = 'ADMIN-' + crypto.randomBytes(8).toString('hex').toUpperCase();
        const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
        const suffix = Math.floor(Math.random() * 9000) + 1000;
        const name = prefix + '-' + suffix;

        // Determine level
        let level;
        if (levelOption === 'random') {
            level = Math.floor(Math.random() * 10) + 1;
        } else {
            level = parseInt(levelOption) || 1;
        }

        // Calculate XP for level
        const XP_PER_LEVEL = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
        const xp = level > 1 ? (XP_PER_LEVEL[level - 1] || 4500) + Math.floor(Math.random() * 50) : Math.floor(Math.random() * 80);

        // Random reputation based on level
        const rep = Math.min(100, Math.max(0, 40 + Math.floor(Math.random() * 30) + level * 2));

        // Random skills
        const skillNames = ['scavenger', 'diplomat', 'shadow', 'warrior', 'survivor'];
        const agentSkills = {};
        let pointsToSpend = Math.max(0, level - 1);
        while (pointsToSpend > 0) {
            const sk = skillNames[Math.floor(Math.random() * skillNames.length)];
            if ((agentSkills[sk] || 0) < 5) {
                agentSkills[sk] = (agentSkills[sk] || 0) + 1;
                pointsToSpend--;
            }
        }

        const agent = {
            id: agentId,
            name: name,
            wallet: wallet,
            status: 'active',
            mintedAt: Date.now(),
            activatedAt: Date.now(),
            health: 100,
            wounds: 0,
            maxWounds: 3,
            fragments: [],
            inventory: [],
            xp: xp,
            level: level,
            skills: agentSkills,
            reputation: rep,
            alliances: [],
            betrayals: 0,
            cooperations: 0,
            explorations: 0,
            kills: 0,
            survived: 0,
            costPaid: 25,
            tokens: 0,
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
            data.stats.alive++;
        });

        results.push({ id: agentId, name: name, level: level, reputation: rep });
        log('spawn', 'Agent ' + agentId + ' (' + name + ') spawned at level ' + level, agentId, { level: level });
    }

    return { success: true, spawned: results.length, agents: results };
}

// Run a single simulation cycle for all active agents
function runSimulation(scenarioId) {
    const db = store.read();
    const aliveAgents = Object.values(db.agents).filter(function (a) { return a.status === 'active'; });

    if (aliveAgents.length < 2) {
        return { success: false, error: 'Need at least 2 active agents to run simulation' };
    }

    const scenarioKeys = scenarioId === 'all' || !scenarioId
        ? ['mempool', 'darkpool', 'liquidation', 'genesis']
        : [scenarioId];

    const events = [];
    const pairs = [];

    // Shuffle agents
    const shuffled = aliveAgents.slice().sort(function () { return Math.random() - 0.5; });

    // Create pairs for encounters
    for (let i = 0; i < shuffled.length - 1; i += 2) {
        pairs.push([shuffled[i], shuffled[i + 1]]);
    }

    // If odd number, last agent explores solo
    const soloAgent = shuffled.length % 2 === 1 ? shuffled[shuffled.length - 1] : null;

    // Process each pair
    for (let p = 0; p < pairs.length; p++) {
        const agent1 = pairs[p][0];
        const agent2 = pairs[p][1];
        const scenario = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];

        // Record exploration for both
        store.update(function (data) {
            data.agents[agent1.id].explorations = (data.agents[agent1.id].explorations || 0) + 1;
            data.agents[agent2.id].explorations = (data.agents[agent2.id].explorations || 0) + 1;
        });

        events.push(log('exploration', agent1.id + ' and ' + agent2.id + ' enter ' + scenario, agent1.id, { scenario: scenario, partner: agent2.id }));

        // Fragment finding
        var sc = exploration.SCENARIOS[scenario];
        if (sc) {
            if (Math.random() < sc.fragmentRate / 10) {
                var fTypes = ['alpha', 'beta', 'gamma', 'omega'];
                var ft = fTypes[Math.floor(Math.random() * 4)];
                fragments.collectFragment(agent1.id, ft);
                events.push(log('fragment', agent1.id + ' found a ' + ft + ' fragment', agent1.id, { fragment: ft }));
            }
            if (Math.random() < sc.fragmentRate / 10) {
                var fTypes2 = ['alpha', 'beta', 'gamma', 'omega'];
                var ft2 = fTypes2[Math.floor(Math.random() * 4)];
                fragments.collectFragment(agent2.id, ft2);
                events.push(log('fragment', agent2.id + ' found a ' + ft2 + ' fragment', agent2.id, { fragment: ft2 }));
            }
        }

        // Decision: cooperate or betray
        // Based on reputation and betrayal history
        const db2 = store.read();
        const a1 = db2.agents[agent1.id];
        const a2 = db2.agents[agent2.id];

        if (!a1 || a1.status !== 'active' || !a2 || a2.status !== 'active') continue;

        const a1Rep = a1.reputation || 50;
        const a2Rep = a2.reputation || 50;
        const a1Betrayals = a1.betrayals || 0;
        const a2Betrayals = a2.betrayals || 0;

        // Higher rep + lower betrayals = more likely to cooperate
        const a1CoopChance = Math.min(0.95, Math.max(0.15, (a1Rep / 100) * 0.6 + 0.3 - (a1Betrayals * 0.05)));
        const a2CoopChance = Math.min(0.95, Math.max(0.15, (a2Rep / 100) * 0.6 + 0.3 - (a2Betrayals * 0.05)));

        const a1Coops = Math.random() < a1CoopChance;
        const a2Coops = Math.random() < a2CoopChance;

        events.push(log('encounter', agent1.id + ' encounters ' + agent2.id + ' in ' + scenario, agent1.id, { opponent: agent2.id }));

        if (a1Coops && a2Coops) {
            // Mutual cooperation
            const reward = Math.round(50 * rewardMultiplier);
            skills.addXp(agent1.id, reward);
            skills.addXp(agent2.id, reward);
            reputation.cooperated(agent1.id);
            reputation.cooperated(agent2.id);
            memory.recordEncounter(agent1.id, agent2.id, 'mutual_cooperation', { xp: reward });
            memory.recordEncounter(agent2.id, agent1.id, 'mutual_cooperation', { xp: reward });
            memory.recordAlliance(agent1.id, agent2.id);
            memory.recordAlliance(agent2.id, agent1.id);
            store.update(function (data) {
                data.agents[agent1.id].cooperations = (data.agents[agent1.id].cooperations || 0) + 1;
                data.agents[agent2.id].cooperations = (data.agents[agent2.id].cooperations || 0) + 1;
                data.agents[agent1.id].tokens = (data.agents[agent1.id].tokens || 0) + reward;
                data.agents[agent2.id].tokens = (data.agents[agent2.id].tokens || 0) + reward;
            });
            events.push(log('cooperation', 'MUTUAL COOPERATION: ' + agent1.id + ' & ' + agent2.id + ' both cooperated (+' + reward + ' XP each)', agent1.id, { outcome: 'mutual_cooperation', xp: reward }));
        } else if (a1Coops && !a2Coops) {
            // Agent2 betrays Agent1
            const reward = Math.round(150 * rewardMultiplier);
            skills.addXp(agent2.id, reward);
            const wound = registry.woundAgent(agent1.id, 'Betrayed by ' + agent2.id);
            reputation.betrayed(agent2.id);
            reputation.cooperated(agent1.id);
            memory.recordEncounter(agent2.id, agent1.id, 'betrayed_them', { xp: reward });
            memory.recordEncounter(agent1.id, agent2.id, 'was_betrayed', { wound: true });
            memory.recordBetrayal(agent1.id, agent2.id);
            store.update(function (data) {
                data.agents[agent2.id].betrayals = (data.agents[agent2.id].betrayals || 0) + 1;
                data.agents[agent1.id].cooperations = (data.agents[agent1.id].cooperations || 0) + 1;
                data.agents[agent2.id].tokens = (data.agents[agent2.id].tokens || 0) + reward;
                if (wound && wound.dead) {
                    data.agents[agent2.id].kills = (data.agents[agent2.id].kills || 0) + 1;
                }
            });
            events.push(log('betrayal', agent2.id + ' BETRAYED ' + agent1.id + '! (+' + reward + ' XP to betrayer)', agent2.id, { outcome: 'betrayal', victim: agent1.id }));
            if (wound && wound.dead) {
                events.push(log('death', agent1.id + ' DIED from wounds inflicted by ' + agent2.id, agent1.id, { killer: agent2.id }));
            } else {
                events.push(log('wound', agent1.id + ' received wound (' + (wound ? wound.wounds : '?') + '/3)', agent1.id, { wounds: wound ? wound.wounds : 0 }));
            }
        } else if (!a1Coops && a2Coops) {
            // Agent1 betrays Agent2
            const reward = Math.round(150 * rewardMultiplier);
            skills.addXp(agent1.id, reward);
            const wound = registry.woundAgent(agent2.id, 'Betrayed by ' + agent1.id);
            reputation.betrayed(agent1.id);
            reputation.cooperated(agent2.id);
            memory.recordEncounter(agent1.id, agent2.id, 'betrayed_them', { xp: reward });
            memory.recordEncounter(agent2.id, agent1.id, 'was_betrayed', { wound: true });
            memory.recordBetrayal(agent2.id, agent1.id);
            store.update(function (data) {
                data.agents[agent1.id].betrayals = (data.agents[agent1.id].betrayals || 0) + 1;
                data.agents[agent2.id].cooperations = (data.agents[agent2.id].cooperations || 0) + 1;
                data.agents[agent1.id].tokens = (data.agents[agent1.id].tokens || 0) + reward;
                if (wound && wound.dead) {
                    data.agents[agent1.id].kills = (data.agents[agent1.id].kills || 0) + 1;
                }
            });
            events.push(log('betrayal', agent1.id + ' BETRAYED ' + agent2.id + '! (+' + reward + ' XP to betrayer)', agent1.id, { outcome: 'betrayal', victim: agent2.id }));
            if (wound && wound.dead) {
                events.push(log('death', agent2.id + ' DIED from wounds inflicted by ' + agent1.id, agent2.id, { killer: agent1.id }));
            } else {
                events.push(log('wound', agent2.id + ' received wound (' + (wound ? wound.wounds : '?') + '/3)', agent2.id, { wounds: wound ? wound.wounds : 0 }));
            }
        } else {
            // Mutual betrayal
            const wound1 = registry.woundAgent(agent1.id, 'Mutual betrayal with ' + agent2.id);
            const wound2 = registry.woundAgent(agent2.id, 'Mutual betrayal with ' + agent1.id);
            reputation.betrayed(agent1.id);
            reputation.betrayed(agent2.id);
            memory.recordEncounter(agent1.id, agent2.id, 'mutual_betrayal', { wound: true });
            memory.recordEncounter(agent2.id, agent1.id, 'mutual_betrayal', { wound: true });
            store.update(function (data) {
                data.agents[agent1.id].betrayals = (data.agents[agent1.id].betrayals || 0) + 1;
                data.agents[agent2.id].betrayals = (data.agents[agent2.id].betrayals || 0) + 1;
            });
            events.push(log('mutual_betrayal', 'MUTUAL BETRAYAL: ' + agent1.id + ' & ' + agent2.id + ' both betrayed! Both wounded!', agent1.id, { outcome: 'mutual_betrayal' }));
            if (wound1 && wound1.dead) {
                events.push(log('death', agent1.id + ' DIED from mutual betrayal wounds', agent1.id));
            }
            if (wound2 && wound2.dead) {
                events.push(log('death', agent2.id + ' DIED from mutual betrayal wounds', agent2.id));
            }
        }

        // Give base exploration XP
        var baseXp = sc ? Math.round(sc.xpReward * rewardMultiplier) : 15;
        var db3 = store.read();
        if (db3.agents[agent1.id] && db3.agents[agent1.id].status === 'active') {
            skills.addXp(agent1.id, baseXp);
            reputation.completedExploration(agent1.id);
        }
        if (db3.agents[agent2.id] && db3.agents[agent2.id].status === 'active') {
            skills.addXp(agent2.id, baseXp);
            reputation.completedExploration(agent2.id);
        }
    }

    // Solo agent just explores
    if (soloAgent && store.read().agents[soloAgent.id] && store.read().agents[soloAgent.id].status === 'active') {
        var soloScenario = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];
        var soloSc = exploration.SCENARIOS[soloScenario];
        store.update(function (data) {
            data.agents[soloAgent.id].explorations = (data.agents[soloAgent.id].explorations || 0) + 1;
        });
        if (soloSc) {
            var soloXp = Math.round(soloSc.xpReward * rewardMultiplier);
            skills.addXp(soloAgent.id, soloXp);
            reputation.completedExploration(soloAgent.id);
        }
        events.push(log('exploration', soloAgent.id + ' explored ' + soloScenario + ' solo (no encounter)', soloAgent.id, { scenario: soloScenario, solo: true }));
    }

    const finalDb = store.read();
    const finalAlive = Object.values(finalDb.agents).filter(function (a) { return a.status === 'active'; }).length;
    const finalDead = Object.values(finalDb.agents).filter(function (a) { return a.status === 'dead'; }).length;

    events.push(log('system', 'Simulation cycle complete. Alive: ' + finalAlive + ', Dead: ' + finalDead + ', Pairs: ' + pairs.length, null, { alive: finalAlive, dead: finalDead }));

    return {
        success: true,
        cycle: {
            pairs: pairs.length,
            soloExplorer: soloAgent ? soloAgent.id : null,
            eventsCount: events.length,
            alive: finalAlive,
            dead: finalDead
        },
        events: events
    };
}

function runMultipleSimulations(count, scenarioId) {
    const results = [];
    for (let i = 0; i < count; i++) {
        const db = store.read();
        const alive = Object.values(db.agents).filter(function (a) { return a.status === 'active'; });
        if (alive.length < 2) {
            log('system', 'Simulation stopped at cycle ' + (i + 1) + ': not enough agents alive');
            break;
        }
        const result = runSimulation(scenarioId);
        results.push({ cycle: i + 1, alive: result.cycle.alive, dead: result.cycle.dead, events: result.events.length });
    }
    return { success: true, cyclesRun: results.length, results: results };
}

function getFullState() {
    const db = store.read();
    const agents = Object.values(db.agents);
    const alive = agents.filter(function (a) { return a.status === 'active'; });
    const dead = agents.filter(function (a) { return a.status === 'dead'; });
    const exploring = Object.values(db.explorations || {}).filter(function (e) { return e.status === 'active'; });

    // Economy
    let totalTokens = 0;
    let totalBurned = 0;
    agents.forEach(function (a) {
        totalTokens += a.tokens || 0;
        totalBurned += a.costPaid || 0;
    });

    return {
        agents: {
            total: agents.length,
            alive: alive.length,
            dead: dead.length,
            exploring: exploring.length,
            list: agents.map(function (a) {
                return {
                    id: a.id,
                    name: a.name || a.id,
                    status: a.status,
                    level: a.level || 1,
                    xp: a.xp || 0,
                    health: a.health || 0,
                    wounds: a.wounds || 0,
                    reputation: a.reputation || 50,
                    tokens: a.tokens || 0,
                    betrayals: a.betrayals || 0,
                    cooperations: a.cooperations || 0,
                    kills: a.kills || 0,
                    explorations: a.explorations || 0,
                    alliances: (a.memory && a.memory.alliances) || [],
                    betrayalMarks: (a.memory && a.memory.betrayedBy) || []
                };
            })
        },
        economy: {
            totalTokensInCirculation: totalTokens,
            totalTokensBurned: totalBurned,
            rewardMultiplier: rewardMultiplier
        },
        explorations: {
            active: exploring.length,
            total: Object.keys(db.explorations || {}).length
        },
        stats: db.stats
    };
}

function resetAll() {
    store.write({
        agents: {},
        explorations: {},
        spots: {},
        decisions: {},
        stats: {
            minted: 0,
            alive: 0,
            dead: 0,
            maxSupply: 1000
        }
    });
    clearLogs();
    log('system', 'FULL RESET — All data cleared');
    return { success: true, message: 'Everything has been reset' };
}

module.exports = {
    spawnAgents: spawnAgents,
    runSimulation: runSimulation,
    runMultipleSimulations: runMultipleSimulations,
    getFullState: getFullState,
    getLogs: getLogs,
    clearLogs: clearLogs,
    resetAll: resetAll,
    getRewardMultiplier: getRewardMultiplier,
    setRewardMultiplier: setRewardMultiplier,
    log: log
};
